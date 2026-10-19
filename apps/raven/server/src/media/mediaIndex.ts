import { basename, dirname, relative } from 'node:path'
import { Inject, Injectable } from '@nestjs/common'
import {
  type LibraryKind,
  type MediaTracks,
  type ThumbnailState,
  containerOf,
  isMediaTracks,
  isNumber,
  isThumbnailState,
  listOf,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import { parseJsonAs } from '@/db/json'
import type { ProbeResult } from '@/ffmpeg/probe'
import { namedAs } from '@/media/namedAs'
import type { IndexedFile, Reconciled } from '@/scanner/reconcile'
import type { FoundFile } from '@/scanner/walk'

/** A file waiting on ffprobe. */
export type ProbeTarget = { id: number; path: string }

/**
 * A video as the server works with the file itself: where it is and what
 * reading, converting and picturing it need. Never sent to a client.
 */
export type MediaFile = {
  id: number
  libraryId: number
  path: string
  fileName: string
  container: string
  /** Changes whenever the file does, so it keys what is cached of it. */
  mtimeMs: number
  duration: number | null
  videoCodec: string | null
  hdr: boolean
  thumbnail: ThumbnailState
}

type FileRow = {
  id: number
  library_id: number
  path: string
  file_name: string
  container: string
  mtime_ms: number
  duration: number | null
  video_codec: string | null
  hdr: number
  thumbnail: string
}

const isKeyframes = listOf(isNumber)

/** Its name, and the folder it sits in under the folder its titles sit in (a library path, or a letter or group folder). */
const placeOf = (file: FoundFile): { fileName: string; folder: string } => ({
  fileName: basename(file.path),
  folder: relative(file.root, dirname(file.path)),
})

/**
 * The media table as files: the index the scanner diffs the disk against
 * and the changes it writes back, what a probe found, and the file state
 * playing, picturing and deleting a video need.
 */
@Injectable()
export class MediaIndex {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /** The file behind a video, or null when there is no such video. */
  fileOf(id: number): MediaFile | null {
    const row = this.db
      .prepare<[number], FileRow>(
        `SELECT id, library_id, path, file_name, container, mtime_ms, duration, video_codec, hdr,
                thumbnail
           FROM media WHERE id = ?`,
      )
      .get(id)
    return row
      ? {
          id: row.id,
          libraryId: row.library_id,
          path: row.path,
          fileName: row.file_name,
          container: row.container,
          mtimeMs: row.mtime_ms,
          duration: row.duration,
          videoCodec: row.video_codec,
          hdr: row.hdr === 1,
          thumbnail: isThumbnailState(row.thumbnail) ? row.thumbnail : 'pending',
        }
      : null
  }

  /** The library a video is in, or null when there is no such video. */
  libraryOf(id: number): number | null {
    return (
      this.db
        .prepare<[number], { library_id: number }>('SELECT library_id FROM media WHERE id = ?')
        .get(id)?.library_id ?? null
    )
  }

  idsForLibrary(libraryId: number): number[] {
    return this.db
      .prepare<[number], { id: number }>('SELECT id FROM media WHERE library_id = ?')
      .all(libraryId)
      .map((row) => row.id)
  }

  /**
   * Every indexed file in a library, keyed by absolute path. A file probed
   * before tracks were stored counts as unprobed, so the scan probes it
   * again and stores them.
   */
  forLibrary(libraryId: number): Map<string, IndexedFile> {
    const rows = this.db
      .prepare<
        [number],
        { id: number; path: string; size: number; mtime_ms: number; probed: number }
      >(
        `SELECT id, path, size, mtime_ms,
                probed = 1 AND (tracks IS NOT NULL OR probe_error IS NOT NULL) AS probed
           FROM media WHERE library_id = ?`,
      )
      .all(libraryId)
    return new Map(
      rows.map((row) => [
        row.path,
        { id: row.id, size: row.size, mtimeMs: row.mtime_ms, probed: row.probed === 1 },
      ]),
    )
  }

  /** A file new to the library; it changed when it came. */
  insert({
    libraryId,
    kind,
    file,
    at = new Date(),
  }: {
    libraryId: number
    kind: LibraryKind
    file: FoundFile
    at?: Date
  }): number {
    const { fileName, folder } = placeOf(file)
    const named = namedAs({ kind, fileName, folder })
    const result = this.db
      .prepare(
        `INSERT INTO media (library_id, path, file_name, folder, title, year, edition, match, container,
                            size, mtime_ms, added_at, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        libraryId,
        file.path,
        fileName,
        folder,
        named.title,
        named.year,
        named.edition,
        named.match,
        containerOf(fileName),
        file.size,
        Math.round(file.mtimeMs),
        at.toISOString(),
        at.toISOString(),
      )
    return Number(result.lastInsertRowid)
  }

  /** The file was replaced on disk: forget what the old one held so it gets probed again. */
  markChanged({
    id,
    size,
    mtimeMs,
    at = new Date(),
  }: {
    id: number
    size: number
    mtimeMs: number
    at?: Date
  }): void {
    this.db
      .prepare(
        `UPDATE media SET size = ?, mtime_ms = ?, probed = 0, probe_error = NULL, thumbnail = 'pending',
                tracks = NULL, keyframes = NULL, changed_at = ?
          WHERE id = ?`,
      )
      .run(size, Math.round(mtimeMs), at.toISOString(), id)
  }

  /**
   * A file renamed or moved on disk is the same video: it keeps its id, so
   * its match, progress, favourite, plays and thumbnail stay. Its name is
   * read again, and one no match was found for gets another try.
   */
  move({
    id,
    kind,
    file,
    at = new Date(),
  }: {
    id: number
    kind: LibraryKind
    file: FoundFile
    at?: Date
  }): void {
    const { fileName, folder } = placeOf(file)
    const named = namedAs({ kind, fileName, folder })
    this.db
      .prepare(
        `UPDATE media SET path = ?, file_name = ?, folder = ?, title = ?, year = ?, edition = ?,
                container = ?, changed_at = ?,
                match = CASE WHEN match = 'unmatched' THEN ? ELSE match END
          WHERE id = ?`,
      )
      .run(
        file.path,
        fileName,
        folder,
        named.title,
        named.year,
        named.edition,
        containerOf(fileName),
        at.toISOString(),
        named.match,
        id,
      )
  }

  /**
   * Writes what a scan found in one transaction, so nothing reads the
   * library half updated, and hands back the files to probe: the new ones,
   * the replaced ones, and any never probed.
   */
  apply({
    libraryId,
    kind,
    changes,
  }: {
    libraryId: number
    kind: LibraryKind
    changes: Reconciled
  }): ProbeTarget[] {
    const at = new Date()
    return this.db.transaction(() => {
      this.remove(changes.gone)
      changes.moved.forEach(({ id, file }) => this.move({ id, kind, file, at }))
      changes.changed.forEach(({ id, file }) =>
        this.markChanged({ id, size: file.size, mtimeMs: file.mtimeMs, at }),
      )
      const added = changes.added.map((file) => ({
        id: this.insert({ libraryId, kind, file, at }),
        path: file.path,
      }))
      return [
        ...added,
        ...changes.changed.map(({ id, file }) => ({ id, path: file.path })),
        ...changes.unprobed,
      ]
    })()
  }

  /** What a probe found, and the tracks it found. */
  saveProbe({ id, probe, tracks }: { id: number; probe: ProbeResult; tracks: MediaTracks }): void {
    this.db
      .prepare(
        `UPDATE media SET probed = 1, probe_error = NULL, duration = ?, width = ?, height = ?,
                video_codec = ?, video_bit_depth = ?, hdr = ?, audio_codec = ?, audio_channels = ?,
                bitrate = ?, tracks = ?
          WHERE id = ?`,
      )
      .run(
        probe.duration,
        probe.width,
        probe.height,
        probe.videoCodec,
        probe.videoBitDepth,
        probe.hdr ? 1 : 0,
        probe.audioCodec,
        probe.audioChannels,
        probe.bitrate,
        JSON.stringify(tracks),
        id,
      )
  }

  saveProbeError({ id, error }: { id: number; error: string }): void {
    this.db
      .prepare(`UPDATE media SET probed = 1, probe_error = ?, thumbnail = 'failed' WHERE id = ?`)
      .run(error, id)
  }

  /** The embedded tracks a probe stored, or null when there are none yet (or they no longer read). */
  storedTracks(id: number): MediaTracks | null {
    const row = this.db
      .prepare<[number], { tracks: string | null }>('SELECT tracks FROM media WHERE id = ?')
      .get(id)
    if (row?.tracks == null) return null
    return parseJsonAs({ json: row.tracks, guard: isMediaTracks })
  }

  saveTracks({ id, tracks }: { id: number; tracks: MediaTracks }): void {
    this.db.prepare('UPDATE media SET tracks = ? WHERE id = ?').run(JSON.stringify(tracks), id)
  }

  /** The video keyframes a probe stored, in seconds, or null when none are stored (or they no longer read). */
  storedKeyframes(id: number): number[] | null {
    const row = this.db
      .prepare<[number], { keyframes: string | null }>('SELECT keyframes FROM media WHERE id = ?')
      .get(id)
    if (row?.keyframes == null) return null
    return parseJsonAs({ json: row.keyframes, guard: isKeyframes })
  }

  saveKeyframes({ id, keyframes }: { id: number; keyframes: number[] }): void {
    this.db
      .prepare('UPDATE media SET keyframes = ? WHERE id = ?')
      .run(JSON.stringify(keyframes), id)
  }

  setThumbnail({ id, state }: { id: number; state: ThumbnailState }): void {
    this.db.prepare('UPDATE media SET thumbnail = ? WHERE id = ?').run(state, id)
  }

  /** Probed files still waiting on a thumbnail, oldest first, so a restart picks the queue back up. */
  pendingThumbnailIds(): number[] {
    return this.db
      .prepare<[], { id: number }>(
        `SELECT id FROM media WHERE thumbnail = 'pending' AND probed = 1 ORDER BY id`,
      )
      .all()
      .map((row) => row.id)
  }

  /** Drops the rows, and with them each video's progress, favourite and plays. */
  remove(ids: readonly number[]): void {
    const remove = this.db.prepare('DELETE FROM media WHERE id = ?')
    this.db.transaction(() => ids.forEach((id) => remove.run(id)))()
  }
}
