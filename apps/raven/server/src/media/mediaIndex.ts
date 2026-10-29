import { basename, dirname, relative } from 'node:path'
import { Inject, Injectable } from '@nestjs/common'
import {
  type Chapter,
  type LibraryKind,
  type Marker,
  type MediaTracks,
  type ThumbnailState,
  containerOf,
  isChapter,
  isMediaTracks,
  isNumber,
  isThumbnailState,
  listOf,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import { parseJsonAs } from '@/db/json'
import { chapterMarkers } from '@/ffmpeg/chapters'
import type { ProbeResult } from '@/ffmpeg/probe'
import {
  MARKER_STATES,
  forgetDetectedMarkers,
  offerMarkers,
  readMarkers,
} from '@/markers/markerRows'
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

const isChapters = listOf(isChapter)

/** Its name, and the folder it sits in under the folder its titles sit in (a library path, or a letter or group folder). */
const placeOf = (file: FoundFile): { fileName: string; folder: string } => ({
  fileName: basename(file.path),
  folder: relative(file.root, dirname(file.path)),
})

type MediaIndexInsertProps = {
  libraryId: number
  kind: LibraryKind
  file: FoundFile
  at?: Date
}

type MediaIndexMarkChangedProps = {
  id: number
  size: number
  mtimeMs: number
  at?: Date
}

type MediaIndexMoveProps = {
  id: number
  kind: LibraryKind
  file: FoundFile
  at?: Date
}

type MediaIndexApplyProps = {
  libraryId: number
  kind: LibraryKind
  changes: Reconciled
}

type MediaIndexSaveProbeProps = {
  id: number
  probe: ProbeResult
  tracks: MediaTracks
  chapters: readonly Chapter[]
}

type MediaIndexSaveChaptersProps = { id: number; chapters: readonly Chapter[] }

type MediaIndexSaveProbeErrorProps = { id: number; error: string }

type MediaIndexSaveTracksProps = { id: number; tracks: MediaTracks }

type MediaIndexSaveKeyframesProps = { id: number; keyframes: number[] }

type MediaIndexSetThumbnailProps = { id: number; state: ThumbnailState }

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
  insert({ libraryId, kind, file, at = new Date() }: MediaIndexInsertProps): number {
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

  /**
   * The file was replaced on disk: forget what the old one held so it gets
   * probed again, its chapters, the markers they or a detector gave it and
   * its fingerprint included, and detection runs again. An admin's own
   * markers stay.
   */
  markChanged({ id, size, mtimeMs, at = new Date() }: MediaIndexMarkChangedProps): void {
    this.db
      .prepare(
        `UPDATE media SET size = ?, mtime_ms = ?, probed = 0, probe_error = NULL, thumbnail = 'pending',
                tracks = NULL, keyframes = NULL, chapters = NULL, markers = ?, changed_at = ?
          WHERE id = ?`,
      )
      .run(size, Math.round(mtimeMs), MARKER_STATES.pending, at.toISOString(), id)
    forgetDetectedMarkers({ db: this.db, mediaId: id })
    this.db.prepare('DELETE FROM media_fingerprints WHERE media_id = ?').run(id)
  }

  /**
   * A file renamed or moved on disk is the same video: it keeps its id, so
   * its match, progress, favourite, plays and thumbnail stay. Its name is
   * read again, and one no match was found for gets another try.
   */
  move({ id, kind, file, at = new Date() }: MediaIndexMoveProps): void {
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
  apply({ libraryId, kind, changes }: MediaIndexApplyProps): ProbeTarget[] {
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

  /** What a probe found: the file's facts, its tracks, its chapters and the markers they name. */
  saveProbe({ id, probe, tracks, chapters }: MediaIndexSaveProbeProps): void {
    this.db.transaction(() => {
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
      this.saveChapters({ id, chapters })
    })()
  }

  saveProbeError({ id, error }: MediaIndexSaveProbeErrorProps): void {
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

  saveTracks({ id, tracks }: MediaIndexSaveTracksProps): void {
    this.db.prepare('UPDATE media SET tracks = ? WHERE id = ?').run(JSON.stringify(tracks), id)
  }

  /** The chapters a probe stored, or null when the file's have not been read yet (or no longer read). */
  storedChapters(id: number): Chapter[] | null {
    const row = this.db
      .prepare<[number], { chapters: string | null }>('SELECT chapters FROM media WHERE id = ?')
      .get(id)
    const chapters = row?.chapters ?? null
    if (chapters === null) return null
    return parseJsonAs({ json: chapters, guard: isChapters })
  }

  /** The file's chapters, and the intro and credits their titles name. */
  saveChapters({ id, chapters }: MediaIndexSaveChaptersProps): void {
    this.db.prepare('UPDATE media SET chapters = ? WHERE id = ?').run(JSON.stringify(chapters), id)
    offerMarkers({ db: this.db, mediaId: id, markers: chapterMarkers(chapters) })
  }

  /** The intro and credits stored for the file, each null when it has none. */
  storedMarkers(id: number): { intro: Marker | null; credits: Marker | null } {
    return readMarkers({ db: this.db, mediaId: id })
  }

  /** The video keyframes a probe stored, in seconds, or null when none are stored (or they no longer read). */
  storedKeyframes(id: number): number[] | null {
    const row = this.db
      .prepare<[number], { keyframes: string | null }>('SELECT keyframes FROM media WHERE id = ?')
      .get(id)
    const keyframes = row?.keyframes ?? null
    if (keyframes === null) return null
    return parseJsonAs({ json: keyframes, guard: isKeyframes })
  }

  saveKeyframes({ id, keyframes }: MediaIndexSaveKeyframesProps): void {
    this.db
      .prepare('UPDATE media SET keyframes = ? WHERE id = ?')
      .run(JSON.stringify(keyframes), id)
  }

  setThumbnail({ id, state }: MediaIndexSetThumbnailProps): void {
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
