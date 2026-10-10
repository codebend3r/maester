import { basename, dirname, relative } from 'node:path'
import { Inject, Injectable } from '@nestjs/common'
import {
  type MediaItem,
  type MediaSort,
  type ThumbnailState,
  containerOf,
  isThumbnailState,
  titleFromFileName,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import type { ProbeResult } from '@/ffmpeg/probe'
import { shuffle } from '@/media/shuffle'

/** A media row with the server-only fields a client never sees. */
export type MediaRecord = MediaItem & {
  path: string
  probed: boolean
  probeError: string | null
  mtimeMs: number
}

/** What the scanner compares against the disk to find new, changed, and gone files. */
export type IndexedFile = {
  id: number
  size: number
  mtimeMs: number
  probed: boolean
}

export type FoundFile = {
  path: string
  /** The library path the walk found it under. */
  root: string
  size: number
  mtimeMs: number
}

type MediaRow = {
  id: number
  library_id: number
  path: string
  file_name: string
  folder: string
  title: string
  container: string
  size: number
  mtime_ms: number
  probed: number
  probe_error: string | null
  duration: number | null
  width: number | null
  height: number | null
  video_codec: string | null
  video_bit_depth: number | null
  hdr: number
  audio_codec: string | null
  audio_channels: number | null
  bitrate: number | null
  thumbnail: string
  added_at: string
  position: number | null
  favourited_at: string | null
}

/** A saved spot counts only while its library saves progress; turned off, it is kept but not shown. */
const SELECT_MEDIA = `
  SELECT m.*, CASE WHEN l.save_progress = 1 THEN p.position END AS position,
         f.added_at AS favourited_at
    FROM media m
    JOIN libraries l ON l.id = m.library_id
    LEFT JOIN playback_progress p ON p.media_id = m.id
    LEFT JOIN favourites f ON f.media_id = m.id`

const toRecord = (row: MediaRow): MediaRecord => ({
  id: row.id,
  libraryId: row.library_id,
  path: row.path,
  title: row.title,
  fileName: row.file_name,
  folder: row.folder,
  size: row.size,
  container: row.container,
  duration: row.duration,
  width: row.width,
  height: row.height,
  videoCodec: row.video_codec,
  videoBitDepth: row.video_bit_depth,
  hdr: row.hdr === 1,
  audioCodec: row.audio_codec,
  audioChannels: row.audio_channels,
  bitrate: row.bitrate,
  thumbnail: isThumbnailState(row.thumbnail) ? row.thumbnail : 'pending',
  thumbnailVersion: row.mtime_ms,
  mtimeMs: row.mtime_ms,
  position: row.position ?? 0,
  favourite: row.favourited_at != null,
  probed: row.probed === 1,
  probeError: row.probe_error,
  addedAt: row.added_at,
})

/** The client-facing view of a record: no absolute paths or internal bookkeeping. */
export const toMediaItem = ({
  path: _path,
  probed: _probed,
  probeError: _probeError,
  mtimeMs: _mtimeMs,
  ...item
}: MediaRecord): MediaItem => item

const BY_TITLE = 'm.title COLLATE NOCASE, m.id'

/**
 * ORDER BY for each sort. Ties fall back to title. Bitrate and resolution are
 * unknown until a file is probed, and those files go last either way.
 * Random lists by title here and is shuffled after.
 */
const ORDER_BY: Record<MediaSort, string> = {
  title: BY_TITLE,
  added: 'm.added_at DESC, m.id DESC',
  oldest: 'm.added_at, m.id',
  largest: `m.size DESC, ${BY_TITLE}`,
  smallest: `m.size, ${BY_TITLE}`,
  'bitrate-high': `m.bitrate IS NULL, m.bitrate DESC, ${BY_TITLE}`,
  'bitrate-low': `m.bitrate IS NULL, m.bitrate, ${BY_TITLE}`,
  'resolution-high': `m.width * m.height IS NULL, m.width * m.height DESC, ${BY_TITLE}`,
  'resolution-low': `m.width * m.height IS NULL, m.width * m.height, ${BY_TITLE}`,
  random: BY_TITLE,
}

/** `%` and `_` are LIKE wildcards; a search for "50%" should match the text "50%". */
const likePattern = (search: string): string =>
  `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

@Injectable()
export class MediaRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /** A library's videos in `sort` order; `seed` decides a random one. */
  list({
    libraryId,
    search = '',
    sort = 'title',
    seed = 0,
  }: {
    libraryId: number
    search?: string
    sort?: MediaSort
    seed?: number
  }): MediaRecord[] {
    const records = this.db
      .prepare<[number, string], MediaRow>(
        `${SELECT_MEDIA}
          WHERE m.library_id = ? AND m.title LIKE ? ESCAPE '\\'
          ORDER BY ${ORDER_BY[sort]}`,
      )
      .all(libraryId, likePattern(search.trim()))
      .map(toRecord)
    return sort === 'random' ? shuffle({ items: records, seed }) : records
  }

  get(id: number): MediaRecord | null {
    const row = this.db.prepare<[number], MediaRow>(`${SELECT_MEDIA} WHERE m.id = ?`).get(id)
    return row ? toRecord(row) : null
  }

  /** Every favourite across every library, most recently marked first. */
  listFavourites(): MediaRecord[] {
    return this.db
      .prepare<[], MediaRow>(
        `${SELECT_MEDIA} WHERE f.media_id IS NOT NULL ORDER BY f.added_at DESC, m.id DESC`,
      )
      .all()
      .map(toRecord)
  }

  /** Marking a favourite again keeps its original time, so the list does not reshuffle. */
  setFavourite({ id, favourite }: { id: number; favourite: boolean }): void {
    if (!favourite) {
      this.db.prepare('DELETE FROM favourites WHERE media_id = ?').run(id)
      return
    }
    this.db
      .prepare(
        `INSERT INTO favourites (media_id, added_at) VALUES (?, ?)
         ON CONFLICT (media_id) DO NOTHING`,
      )
      .run(id, new Date().toISOString())
  }

  idsForLibrary(libraryId: number): number[] {
    return this.db
      .prepare<[number], { id: number }>('SELECT id FROM media WHERE library_id = ?')
      .all(libraryId)
      .map((row) => row.id)
  }

  /** Every indexed file in a library, keyed by absolute path. */
  indexForLibrary(libraryId: number): Map<string, IndexedFile> {
    const rows = this.db
      .prepare<
        [number],
        { id: number; path: string; size: number; mtime_ms: number; probed: number }
      >('SELECT id, path, size, mtime_ms, probed FROM media WHERE library_id = ?')
      .all(libraryId)
    return new Map(
      rows.map((row) => [
        row.path,
        { id: row.id, size: row.size, mtimeMs: row.mtime_ms, probed: row.probed === 1 },
      ]),
    )
  }

  insert({ libraryId, file }: { libraryId: number; file: FoundFile }): number {
    const fileName = basename(file.path)
    const folder = relative(file.root, dirname(file.path))
    const result = this.db
      .prepare(
        `INSERT INTO media (library_id, path, file_name, folder, title, container, size, mtime_ms, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        libraryId,
        file.path,
        fileName,
        folder,
        titleFromFileName(fileName),
        containerOf(fileName),
        file.size,
        Math.round(file.mtimeMs),
        new Date().toISOString(),
      )
    return Number(result.lastInsertRowid)
  }

  /** The file was replaced on disk: forget what the old one held so it gets probed again. */
  markChanged({ id, size, mtimeMs }: { id: number; size: number; mtimeMs: number }): void {
    this.db
      .prepare(
        `UPDATE media SET size = ?, mtime_ms = ?, probed = 0, probe_error = NULL, thumbnail = 'pending'
          WHERE id = ?`,
      )
      .run(size, Math.round(mtimeMs), id)
  }

  saveProbe({ id, probe }: { id: number; probe: ProbeResult }): void {
    this.db
      .prepare(
        `UPDATE media SET probed = 1, probe_error = NULL, duration = ?, width = ?, height = ?,
                video_codec = ?, video_bit_depth = ?, hdr = ?, audio_codec = ?, audio_channels = ?,
                bitrate = ?
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
        id,
      )
  }

  saveProbeError({ id, error }: { id: number; error: string }): void {
    this.db
      .prepare(`UPDATE media SET probed = 1, probe_error = ?, thumbnail = 'failed' WHERE id = ?`)
      .run(error, id)
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

  removeMany(ids: readonly number[]): void {
    const remove = this.db.prepare('DELETE FROM media WHERE id = ?')
    this.db.transaction(() => ids.forEach((id) => remove.run(id)))()
  }

  /**
   * The last 5% counts as finished, so the next play starts from the top; so
   * do the first few seconds (5s, or 5% of a short clip), which are a
   * misclick rather than a place to come back to.
   *
   * A library with progress saving off records nothing, not even the
   * clearing of a finished video, so turning it back on resumes from the
   * spots it had.
   */
  saveProgress({ id, position }: { id: number; position: number }): void {
    const target = this.db
      .prepare<[number], { duration: number | null; save_progress: number }>(
        `SELECT m.duration, l.save_progress
           FROM media m
           JOIN libraries l ON l.id = m.library_id
          WHERE m.id = ?`,
      )
      .get(id)
    if (!target || target.save_progress !== 1) return
    const duration = target.duration
    const finished = duration != null && position >= duration * 0.95
    const barelyStarted = position < Math.min(5, (duration ?? 100) * 0.05)
    if (finished || barelyStarted) {
      this.db.prepare('DELETE FROM playback_progress WHERE media_id = ?').run(id)
      return
    }
    this.db
      .prepare(
        `INSERT INTO playback_progress (media_id, position, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (media_id) DO UPDATE SET position = excluded.position, updated_at = excluded.updated_at`,
      )
      .run(id, position, new Date().toISOString())
  }
}
