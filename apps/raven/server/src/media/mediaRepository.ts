import { basename, dirname, relative } from 'node:path'
import { Inject, Injectable } from '@nestjs/common'
import {
  type MediaItem,
  type MediaSort,
  type MediaTracks,
  type ThumbnailState,
  containerOf,
  isMediaTracks,
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

/** A played video in a library's history, with the server-only record. */
export type HistoryRecord = {
  record: MediaRecord
  lastPlayedAt: string
  plays: number
  furthest: number
  watched: boolean
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

/** A video played again within this long of its last report is the same sitting, so the same play. */
const SITTING_MS = 30 * 60 * 1000

type HistoryRow = {
  id: number
  last_played_at: string
  plays: number
  furthest: number
  watched: number
}

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

  /** The play a report at `at` belongs to: the video's latest, while it is in the same sitting, or a new one. */
  private sittingPlay({ id, at }: { id: number; at: Date }): number {
    const since = new Date(at.getTime() - SITTING_MS).toISOString()
    const latest = this.db
      .prepare<[number, string], { id: number }>(
        `SELECT id FROM plays WHERE media_id = ? AND played_at >= ?
          ORDER BY played_at DESC, id DESC LIMIT 1`,
      )
      .get(id, since)
    if (latest) return latest.id
    const result = this.db
      .prepare('INSERT INTO plays (media_id, played_at) VALUES (?, ?)')
      .run(id, at.toISOString())
    return Number(result.lastInsertRowid)
  }

  /** A video started playing. */
  recordPlay({ id, at = new Date() }: { id: number; at?: Date }): void {
    this.db.transaction(() => {
      const play = this.sittingPlay({ id, at })
      this.db.prepare('UPDATE plays SET played_at = ? WHERE id = ?').run(at.toISOString(), play)
    })()
  }

  /**
   * How far playback has got, for the history. Kept whatever the library's
   * progress setting, which is only about resuming.
   */
  notePlayedTo({
    id,
    position,
    at = new Date(),
  }: {
    id: number
    position: number
    at?: Date
  }): void {
    this.db.transaction(() => {
      const play = this.sittingPlay({ id, at })
      this.db
        .prepare('UPDATE plays SET played_at = ?, furthest = MAX(furthest, ?) WHERE id = ?')
        .run(at.toISOString(), position, play)
    })()
  }

  /**
   * A library's played videos, each once, by when it last played. One counts
   * as watched once a play got past the library's watched percentage; one
   * whose length is still unknown never does.
   */
  history({
    libraryId,
    limit,
    watchedOnly = false,
  }: {
    libraryId: number
    limit: number
    watchedOnly?: boolean
  }): HistoryRecord[] {
    const rows = this.db
      .prepare<[number, number], HistoryRow>(
        `SELECT pl.media_id AS id, MAX(pl.played_at) AS last_played_at, COUNT(*) AS plays,
                MAX(pl.furthest) AS furthest,
                CASE WHEN m.duration > 0
                      AND MAX(pl.furthest) >= m.duration * l.watched_percent / 100.0
                     THEN 1 ELSE 0 END AS watched
           FROM plays pl
           JOIN media m ON m.id = pl.media_id
           JOIN libraries l ON l.id = m.library_id
          WHERE m.library_id = ?
          GROUP BY pl.media_id
          ${watchedOnly ? 'HAVING watched = 1' : ''}
          ORDER BY last_played_at DESC, pl.media_id DESC
          LIMIT ?`,
      )
      .all(libraryId, limit)
    const records = new Map(
      this.db
        .prepare<[string], MediaRow>(
          `${SELECT_MEDIA} WHERE m.id IN (SELECT value FROM json_each(?))`,
        )
        .all(JSON.stringify(rows.map((row) => row.id)))
        .map((row) => [row.id, toRecord(row)]),
    )
    return rows.flatMap((row) => {
      const record = records.get(row.id)
      return record
        ? [
            {
              record,
              lastPlayedAt: row.last_played_at,
              plays: row.plays,
              furthest: row.furthest,
              watched: row.watched === 1,
            },
          ]
        : []
    })
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
        `UPDATE media SET size = ?, mtime_ms = ?, probed = 0, probe_error = NULL, thumbnail = 'pending',
                tracks = NULL
          WHERE id = ?`,
      )
      .run(size, Math.round(mtimeMs), id)
  }

  /** What a probe found, and the tracks it found when the caller has them. */
  saveProbe({ id, probe, tracks }: { id: number; probe: ProbeResult; tracks?: MediaTracks }): void {
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
        tracks ? JSON.stringify(tracks) : null,
        id,
      )
  }

  /** The embedded tracks a probe stored, or null when there are none yet (or they no longer read). */
  storedTracks(id: number): MediaTracks | null {
    const row = this.db
      .prepare<[number], { tracks: string | null }>('SELECT tracks FROM media WHERE id = ?')
      .get(id)
    if (row?.tracks == null) return null
    try {
      const parsed: unknown = JSON.parse(row.tracks)
      return isMediaTracks(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  saveTracks({ id, tracks }: { id: number; tracks: MediaTracks }): void {
    this.db.prepare('UPDATE media SET tracks = ? WHERE id = ?').run(JSON.stringify(tracks), id)
  }

  forgetTracks(id: number): void {
    this.db.prepare('UPDATE media SET tracks = NULL WHERE id = ?').run(id)
  }

  /** Videos probed without trouble whose tracks are not stored yet: indexed before they were. */
  idsMissingTracks(libraryId: number): number[] {
    return this.db
      .prepare<[number], { id: number }>(
        `SELECT id FROM media
          WHERE library_id = ? AND probed = 1 AND probe_error IS NULL AND tracks IS NULL
          ORDER BY id`,
      )
      .all(libraryId)
      .map((row) => row.id)
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
