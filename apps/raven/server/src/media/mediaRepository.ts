import { Inject, Injectable } from '@nestjs/common'
import {
  type ItemSummary,
  type LibraryKind,
  type MatchState,
  type MediaItem,
  type MediaSort,
  type MediaTracks,
  type ThumbnailState,
  isExtra,
  isMatchState,
  isMediaTracks,
  isThumbnailState,
  parseEpisodeName,
  parseMovieName,
  titleFromFileName,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import type { ProbeResult } from '@/ffmpeg/probe'
import { shuffle } from '@/media/shuffle'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { shuffle as shuffleShows } from '@/media/shuffle'

/** A media row with the server-only fields a client never sees. */
export type MediaRecord = MediaItem & {
  path: string
  probed: boolean
  probeError: string | null
  mtimeMs: number
  itemId: number | null
}

/** A played video in a library's history, with the server-only record. */
export type HistoryRecord = {
  record: MediaRecord
  lastPlayedAt: string
  plays: number
  furthest: number
  watched: boolean
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
  changed_at: string
  year: number | null
  edition: string | null
  match: string
  position: number | null
  favourited_at: string | null
  item_id: number | null
  versions: number
  score: number | null
}

/** A file waiting to be matched, with what matching needs: its name and where it sits. */
export type PendingFile = {
  id: number
  libraryId: number
  path: string
  fileName: string
  folder: string
  title: string
  year: number | null
}

/**
 * A saved spot counts only while its library saves progress; turned off, it
 * is kept but not shown. A file holding two episodes takes the first as its
 * item. `versions` counts the files in the library that are the same movie.
 */
const SELECT_COLUMNS = `
  SELECT m.*, CASE WHEN l.save_progress = 1 THEN p.position END AS position,
         f.added_at AS favourited_at,
         i.id AS item_id, i.type AS item_type, i.title AS item_title,
         i.original_title AS item_original_title, i.sort_title AS item_sort_title,
         i.year AS item_year,
         CASE WHEN i.type = 'movie'
              THEN (SELECT COUNT(*) FROM media_items x JOIN media y ON y.id = x.media_id
                     WHERE x.item_id = i.id AND y.library_id = m.library_id)
              ELSE 1 END AS versions,
         COALESCE((SELECT r.value FROM ratings r WHERE r.item_id = i.id AND r.source = l.ratings_source),
                  (SELECT r.value FROM ratings r WHERE r.item_id = i.id AND r.source = 'tmdb')) AS score`

const FROM_MEDIA = `
    FROM media m
    JOIN libraries l ON l.id = m.library_id
    LEFT JOIN playback_progress p ON p.media_id = m.id
    LEFT JOIN favourites f ON f.media_id = m.id
    LEFT JOIN (SELECT media_id, MIN(item_id) AS item_id FROM media_items GROUP BY media_id) mi
      ON mi.media_id = m.id
    LEFT JOIN shown_items i ON i.id = mi.item_id`

const SELECT_MEDIA = `${SELECT_COLUMNS}${FROM_MEDIA}`

/** The best of a movie's files first: the most pixels, then the biggest file. */
const BEST_FIRST = 'COALESCE(m.width * m.height, 0) DESC, m.size DESC, m.id'

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
  changedAt: row.changed_at,
  match: isMatchState(row.match) ? row.match : 'pending',
  year: row.year,
  edition: row.edition,
  item: null,
  versions: row.versions,
  itemId: row.item_id,
})

/** What a name says a file is, by its library's type. Extras and other libraries keep the tidied name. */
export const namedAs = ({
  kind,
  fileName,
  folder,
}: {
  kind: LibraryKind
  fileName: string
  folder: string
}): { title: string; year: number | null; edition: string | null; match: MatchState } => {
  if (kind === 'other' || isExtra({ fileName, folder })) {
    return { title: titleFromFileName(fileName), year: null, edition: null, match: 'off' }
  }
  if (kind === 'movies') {
    const parsed = parseMovieName({ fileName, folder })
    return { title: parsed.title, year: parsed.year, edition: parsed.edition, match: 'pending' }
  }
  // An episode keeps its tidied file name until it is matched, since the
  // name alone rarely says which show it is; the year is the show's.
  const parsed = parseEpisodeName({ fileName, folder })
  return { title: titleFromFileName(fileName), year: parsed.year, edition: null, match: 'pending' }
}

/** A show in a TV library's listing, before its next episode is looked up. */
type ShowRow = {
  id: number
  ended: string | null
  episodes: number
  added_at: string
}

/** A show's listing order: sorts that only mean something per file fall back to title. */
const SHOW_ORDER_BY: Record<MediaSort, string> = {
  title: 'sh.sort_title COLLATE NOCASE, sh.id',
  added: 'added_at DESC, sh.id DESC',
  oldest: 'added_at, sh.id',
  changed: 'changed_at DESC, sh.id DESC',
  largest: 'sh.sort_title COLLATE NOCASE, sh.id',
  smallest: 'sh.sort_title COLLATE NOCASE, sh.id',
  'bitrate-high': 'sh.sort_title COLLATE NOCASE, sh.id',
  'bitrate-low': 'sh.sort_title COLLATE NOCASE, sh.id',
  'resolution-high': 'sh.sort_title COLLATE NOCASE, sh.id',
  'resolution-low': 'sh.sort_title COLLATE NOCASE, sh.id',
  'year-new': 'sh.year IS NULL, sh.year DESC, sh.sort_title COLLATE NOCASE, sh.id',
  'year-old': 'sh.year IS NULL, sh.year, sh.sort_title COLLATE NOCASE, sh.id',
  'rating-high': 'score IS NULL, score DESC, sh.sort_title COLLATE NOCASE, sh.id',
  'rating-low': 'score IS NULL, score, sh.sort_title COLLATE NOCASE, sh.id',
  random: 'sh.sort_title COLLATE NOCASE, sh.id',
}

/** The files of a library that are episodes, with their show and numbers. */
const EPISODE_FILES = `
  SELECT m.id AS media_id, m.added_at, m.changed_at, e.id AS episode_id, s.parent_id AS show_id,
         s.number AS season, e.number AS episode
    FROM media m
    JOIN media_items mi ON mi.media_id = m.id
    JOIN shown_items e ON e.id = mi.item_id AND e.type = 'episode'
    JOIN shown_items s ON s.id = e.parent_id
   WHERE m.library_id = ?`

/** What `listShows` returns before the records are attached. */
export type ShowRecord = {
  show: ItemSummary
  episodes: number
  endedYear: number | null
  addedAt: string
  next: MediaRecord | null
}

/** The client-facing view of a record: no absolute paths or internal bookkeeping. */
export const toMediaItem = ({
  path: _path,
  probed: _probed,
  probeError: _probeError,
  mtimeMs: _mtimeMs,
  itemId: _itemId,
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

const BY_TITLE = 'COALESCE(item_sort_title, title) COLLATE NOCASE, id'

const YEAR = 'COALESCE(item_year, year)'

/**
 * ORDER BY for each sort, over the listing's columns. Ties fall back to
 * title. Bitrate, resolution and year are unknown for some files, and those
 * go last either way. Random lists by title here and is shuffled after.
 */
const ORDER_BY: Record<MediaSort, string> = {
  title: BY_TITLE,
  added: 'added_at DESC, id DESC',
  oldest: 'added_at, id',
  changed: 'changed_at DESC, id DESC',
  largest: `size DESC, ${BY_TITLE}`,
  smallest: `size, ${BY_TITLE}`,
  'bitrate-high': `bitrate IS NULL, bitrate DESC, ${BY_TITLE}`,
  'bitrate-low': `bitrate IS NULL, bitrate, ${BY_TITLE}`,
  'resolution-high': `width * height IS NULL, width * height DESC, ${BY_TITLE}`,
  'resolution-low': `width * height IS NULL, width * height, ${BY_TITLE}`,
  'year-new': `${YEAR} IS NULL, ${YEAR} DESC, ${BY_TITLE}`,
  'year-old': `${YEAR} IS NULL, ${YEAR}, ${BY_TITLE}`,
  'rating-high': `score IS NULL, score DESC, ${BY_TITLE}`,
  'rating-low': `score IS NULL, score, ${BY_TITLE}`,
  random: BY_TITLE,
}

/** `%` and `_` are LIKE wildcards; a search for "50%" should match the text "50%". */
const likePattern = (search: string): string =>
  `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

@Injectable()
export class MediaRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
  ) {}

  private get db() {
    return this.database.db
  }

  /** Records for rows, each with its item's summary attached. */
  private records(rows: readonly MediaRow[]): MediaRecord[] {
    const summaries = this.metadata.summaries(
      rows.flatMap((row) => (row.item_id == null ? [] : [row.item_id])),
    )
    return rows.map((row) => ({
      ...toRecord(row),
      item: row.item_id == null ? null : (summaries.get(row.item_id) ?? null),
    }))
  }

  /**
   * A library's videos in `sort` order; `seed` decides a random one. A movie
   * kept as several files is one entry, its best file, with `versions` saying
   * how many there are. Search matches the file's title and its movie's.
   */
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
    const pattern = likePattern(search.trim())
    const rows = this.db
      .prepare<[number, string, string, string], MediaRow>(
        `WITH listed AS (
           ${SELECT_COLUMNS},
                  ROW_NUMBER() OVER (
                    PARTITION BY CASE WHEN i.type = 'movie' THEN i.id ELSE -m.id END
                    ORDER BY ${BEST_FIRST}) AS version_rank
           ${FROM_MEDIA}
            WHERE m.library_id = ?)
         SELECT * FROM listed
          WHERE version_rank = 1
            AND (title LIKE ? ESCAPE '\\' OR item_title LIKE ? ESCAPE '\\'
                 OR item_original_title LIKE ? ESCAPE '\\')
          ORDER BY ${ORDER_BY[sort]}`,
      )
      .all(libraryId, pattern, pattern, pattern)
    const records = this.records(rows)
    return sort === 'random' ? shuffle({ items: records, seed }) : records
  }

  get(id: number): MediaRecord | null {
    const row = this.db.prepare<[number], MediaRow>(`${SELECT_MEDIA} WHERE m.id = ?`).get(id)
    return row ? (this.records([row])[0] ?? null) : null
  }

  /**
   * A TV library as its shows: how many episodes each has on disk, when
   * its newest file came, and the first episode not yet watched by the
   * library's measure (specials last). Search matches show titles.
   */
  listShows({
    libraryId,
    search = '',
    sort = 'title',
    seed = 0,
  }: {
    libraryId: number
    search?: string
    sort?: MediaSort
    seed?: number
  }): ShowRecord[] {
    const pattern = likePattern(search.trim())
    const rows = this.db
      .prepare<[number, number, string, string], ShowRow>(
        `WITH files AS (${EPISODE_FILES})
         SELECT sh.id, sh.ended, COUNT(DISTINCT f.episode_id) AS episodes, MAX(f.added_at) AS added_at,
                MAX(f.changed_at) AS changed_at,
                COALESCE((SELECT r.value FROM ratings r WHERE r.item_id = sh.id
                           AND r.source = (SELECT l.ratings_source FROM libraries l WHERE l.id = ?)),
                         (SELECT r.value FROM ratings r WHERE r.item_id = sh.id AND r.source = 'tmdb')) AS score
           FROM files f JOIN shown_items sh ON sh.id = f.show_id
          WHERE sh.title LIKE ? ESCAPE '\\' OR sh.original_title LIKE ? ESCAPE '\\'
          GROUP BY sh.id
          ORDER BY ${SHOW_ORDER_BY[sort]}`,
      )
      .all(libraryId, libraryId, pattern, pattern)
    const summaries = this.metadata.summaries(rows.map((row) => row.id))
    const nextUnwatched = this.db.prepare<[number, number], { media_id: number }>(
      `WITH files AS (${EPISODE_FILES})
       SELECT f.media_id FROM files f
         JOIN media m ON m.id = f.media_id
         JOIN libraries l ON l.id = m.library_id
         LEFT JOIN (SELECT media_id, MAX(furthest) AS furthest FROM plays GROUP BY media_id) p
           ON p.media_id = m.id
        WHERE f.show_id = ?
          AND NOT (m.duration > 0 AND COALESCE(p.furthest, 0) >= m.duration * l.watched_percent / 100.0)
        ORDER BY f.season = 0, f.season, f.episode, COALESCE(m.width * m.height, 0) DESC, m.id
        LIMIT 1`,
    )
    const entries = rows.flatMap((row): ShowRecord[] => {
      const show = summaries.get(row.id)
      if (!show) return []
      const next = nextUnwatched.get(libraryId, row.id)
      return [
        {
          show,
          episodes: row.episodes,
          endedYear: row.ended == null ? null : Number(row.ended.slice(0, 4)) || null,
          addedAt: row.added_at,
          next: next ? this.get(next.media_id) : null,
        },
      ]
    })
    return sort === 'random' ? shuffleShows({ items: entries, seed }) : entries
  }

  /**
   * The first episode of a show not yet watched, by the measure of whichever
   * library holds the file, specials last; null once every one is watched.
   */
  nextEpisode(showId: number): MediaRecord | null {
    const row = this.db
      .prepare<[number], { media_id: number }>(
        `SELECT m.id AS media_id
           FROM media m
           JOIN libraries l ON l.id = m.library_id
           JOIN media_items mi ON mi.media_id = m.id
           JOIN shown_items e ON e.id = mi.item_id AND e.type = 'episode'
           JOIN shown_items s ON s.id = e.parent_id
           LEFT JOIN (SELECT media_id, MAX(furthest) AS furthest FROM plays GROUP BY media_id) p
             ON p.media_id = m.id
          WHERE s.parent_id = ?
            AND NOT (m.duration > 0 AND COALESCE(p.furthest, 0) >= m.duration * l.watched_percent / 100.0)
          ORDER BY s.number = 0, s.number, e.number, COALESCE(m.width * m.height, 0) DESC, m.id
          LIMIT 1`,
      )
      .get(showId)
    return row ? this.get(row.media_id) : null
  }

  /** A library's files no show or movie was found for, pending ones included, by title. */
  listUnmatched({ libraryId, search = '' }: { libraryId: number; search?: string }): MediaRecord[] {
    return this.records(
      this.db
        .prepare<[number, string], MediaRow>(
          `${SELECT_MEDIA}
            WHERE m.library_id = ? AND m.match IN ('pending', 'unmatched')
              AND m.title LIKE ? ESCAPE '\\'
            ORDER BY ${BY_TITLE.replace(/\b(item_sort_title|title|id)\b/g, 'm.$1').replace('m.item_sort_title', 'NULL')}`,
        )
        .all(libraryId, likePattern(search.trim())),
    )
  }

  /** Every file that is an item, in any library, best first. */
  forItem(itemId: number): MediaRecord[] {
    return this.records(
      this.db
        .prepare<[number], MediaRow>(
          `${SELECT_MEDIA}
            WHERE m.id IN (SELECT media_id FROM media_items WHERE item_id = ?)
            ORDER BY ${BEST_FIRST}`,
        )
        .all(itemId),
    )
  }

  /** Every favourite across every library, most recently marked first. */
  listFavourites(): MediaRecord[] {
    const rows = this.db
      .prepare<[], MediaRow>(
        `${SELECT_MEDIA} WHERE f.media_id IS NOT NULL ORDER BY f.added_at DESC, m.id DESC`,
      )
      .all()
    return this.records(rows)
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
      this.records(
        this.db
          .prepare<[string], MediaRow>(
            `${SELECT_MEDIA} WHERE m.id IN (SELECT value FROM json_each(?))`,
          )
          .all(JSON.stringify(rows.map((row) => row.id))),
      ).map((record) => [record.id, record]),
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

  /**
   * Reads every file's name again for the library's type, and starts its
   * matching over: links go, and files are pending, or off in a library that
   * is not Movies or TV shows. Run when a library's type changes.
   */
  rename({ libraryId, kind }: { libraryId: number; kind: LibraryKind }): void {
    const rows = this.db
      .prepare<[number], { id: number; file_name: string; folder: string }>(
        'SELECT id, file_name, folder FROM media WHERE library_id = ?',
      )
      .all(libraryId)
    const update = this.db.prepare(
      'UPDATE media SET title = ?, year = ?, edition = ?, match = ? WHERE id = ?',
    )
    this.db.transaction(() => {
      this.metadata.unlink(rows.map((row) => row.id))
      rows.forEach((row) => {
        const named = namedAs({ kind, fileName: row.file_name, folder: row.folder })
        update.run(named.title, named.year, named.edition, named.match, row.id)
      })
    })()
  }

  /**
   * Reads names again without touching matches, for files indexed before
   * names were parsed. Only titles and years the parser now reads change.
   */
  retitle({ libraryId, kind }: { libraryId: number; kind: LibraryKind }): void {
    const rows = this.db
      .prepare<[number], { id: number; file_name: string; folder: string; title: string }>(
        `SELECT id, file_name, folder, title FROM media WHERE library_id = ? AND match = 'pending'`,
      )
      .all(libraryId)
    const update = this.db.prepare(
      'UPDATE media SET title = ?, year = ?, edition = ?, match = ? WHERE id = ?',
    )
    this.db.transaction(() =>
      rows.forEach((row) => {
        const named = namedAs({ kind, fileName: row.file_name, folder: row.folder })
        update.run(named.title, named.year, named.edition, named.match, row.id)
      }),
    )()
  }

  /** A library's files waiting to be matched, by place so a folder's files come together. */
  pending(libraryId: number): PendingFile[] {
    return this.db
      .prepare<
        [number],
        {
          id: number
          library_id: number
          path: string
          file_name: string
          folder: string
          title: string
          year: number | null
        }
      >(
        `SELECT id, library_id, path, file_name, folder, title, year FROM media
          WHERE library_id = ? AND match = 'pending'
          ORDER BY folder, file_name`,
      )
      .all(libraryId)
      .map((row) => ({
        id: row.id,
        libraryId: row.library_id,
        path: row.path,
        fileName: row.file_name,
        folder: row.folder,
        title: row.title,
        year: row.year,
      }))
  }

  /** How many files wait to be matched in libraries of `kinds`. */
  countPending(kinds: readonly LibraryKind[]): number {
    return (
      this.db
        .prepare<[string], { count: number }>(
          `SELECT COUNT(*) AS count FROM media m JOIN libraries l ON l.id = m.library_id
            WHERE m.match = 'pending' AND l.kind IN (SELECT value FROM json_each(?))`,
        )
        .get(JSON.stringify(kinds))?.count ?? 0
    )
  }

  /** A library's files in `folder`, with their names, for the files sharing a place. */
  inFolder({ libraryId, folder }: { libraryId: number; folder: string }): PendingFile[] {
    return this.db
      .prepare<
        [number, string],
        {
          id: number
          library_id: number
          path: string
          file_name: string
          folder: string
          title: string
          year: number | null
        }
      >(
        `SELECT id, library_id, path, file_name, folder, title, year FROM media
          WHERE library_id = ? AND folder = ? ORDER BY file_name`,
      )
      .all(libraryId, folder)
      .map((row) => ({
        id: row.id,
        libraryId: row.library_id,
        path: row.path,
        fileName: row.file_name,
        folder: row.folder,
        title: row.title,
        year: row.year,
      }))
  }

  /** A library's files in `folder` and every folder under it: a show's, season folders included. */
  underFolder({ libraryId, folder }: { libraryId: number; folder: string }): PendingFile[] {
    return this.db
      .prepare<
        [number, string, string],
        {
          id: number
          library_id: number
          path: string
          file_name: string
          folder: string
          title: string
          year: number | null
        }
      >(
        `SELECT id, library_id, path, file_name, folder, title, year FROM media
          WHERE library_id = ? AND (folder = ? OR folder LIKE ? ESCAPE '\\')
          ORDER BY folder, file_name`,
      )
      .all(libraryId, folder, `${likePattern(folder).slice(1, -1)}/%`)
      .map((row) => ({
        id: row.id,
        libraryId: row.library_id,
        path: row.path,
        fileName: row.file_name,
        folder: row.folder,
        title: row.title,
        year: row.year,
      }))
  }

  setMatch({ ids, match }: { ids: readonly number[]; match: MatchState }): void {
    this.db
      .prepare('UPDATE media SET match = ? WHERE id IN (SELECT value FROM json_each(?))')
      .run(match, JSON.stringify(ids))
  }

  /**
   * Puts a library's unmatched files back in the queue, for another search;
   * Fix match choices and extras stay. How many went back.
   */
  retryUnmatched(libraryId: number): number {
    return Number(
      this.db
        .prepare<[number]>(
          `UPDATE media SET match = 'pending' WHERE library_id = ? AND match = 'unmatched'`,
        )
        .run(libraryId).changes,
    )
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
