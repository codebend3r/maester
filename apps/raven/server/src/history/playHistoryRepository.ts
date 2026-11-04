import { Inject, Injectable } from '@nestjs/common'
import {
  type MediaItem,
  PLAYED_KINDS,
  PLAY_HISTORY_SHOWS,
  type PlayHistoryEntry,
  type PlayHistoryPage,
  type PlayHistoryShow,
  type Played,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import { NEXT_HISTORY_ID } from '@/history/playHistorySql'
import { MediaRepository } from '@/media/mediaRepository'
import type { AccountKey, ByAccount } from '@/media/viewingAccountKeys'

/** Where a page ends: the last entry's start, account and number, which the next page reads before. */
export type HistoryCursor = { startedAt: string; accountId: string; id: number }

const CURSOR_SEPARATOR = '~'

/** A cursor as a page hands it on: plain text, since none of its parts holds the separator. */
export const cursorText = ({ startedAt, accountId, id }: HistoryCursor): string =>
  [startedAt, accountId, String(id)].join(CURSOR_SEPARATOR)

/** A cursor a client sent back, or null when it is not one this server made. */
export const parseCursor = (text: string): HistoryCursor | null => {
  const parts = text.split(CURSOR_SEPARATOR)
  if (parts.length !== 3) return null
  const [startedAt = '', accountId = '', idText = ''] = parts
  const id = Number(idText)
  if (!Number.isSafeInteger(id) || id < 1 || startedAt === '' || accountId === '') return null
  return { startedAt, accountId, id }
}

/** Past every real start time, so a first page reads from the newest. */
const NEWEST = { startedAt: '￿', accountId: '￿', id: Number.MAX_SAFE_INTEGER } as const

/** What each choice of `show` keeps, as a condition on the track row joined in. */
const SHOW_FILTERS = {
  [PLAY_HISTORY_SHOWS.all]: '',
  [PLAY_HISTORY_SHOWS.video]: 'AND t.media_id IS NULL',
  [PLAY_HISTORY_SHOWS.music]: 'AND t.media_id IS NOT NULL',
} as const satisfies Record<PlayHistoryShow, string>

type HistoryRow = {
  account_id: string
  id: number
  media_id: number
  started_at: string
  last_played_at: string
  furthest: number | null
  duration: number | null
  library_id: number
  library_name: string
  file_title: string
  track_title: string | null
  disc: number | null
  track_number: number | null
  album_id: number | null
  album_title: string | null
  album_tracks: number | null
  artist: string | null
}

const COLUMNS = `
  SELECT h.account_id, h.id, h.media_id, h.started_at, h.last_played_at, h.furthest,
         m.duration, m.library_id, l.name AS library_name, m.title AS file_title,
         t.title AS track_title, t.disc, t.number AS track_number,
         a.id AS album_id, a.title AS album_title,
         (SELECT COUNT(*) FROM tracks at WHERE at.album_id = a.id) AS album_tracks,
         (SELECT group_concat(name, ', ')
            FROM (SELECT ar.name FROM track_artists ta
                    JOIN artists ar ON ar.id = ta.artist_id
                   WHERE ta.media_id = m.id ORDER BY ta.position)) AS artist
    FROM play_history h
    JOIN media m ON m.id = h.media_id
    JOIN libraries l ON l.id = m.library_id
    LEFT JOIN tracks t ON t.media_id = m.id
    LEFT JOIN albums a ON a.id = t.album_id`

type PlayedVideoProps = { media: MediaItem | undefined; title: string }

/** What a video was, by its match: an episode of its show, a movie, or the file's own title. */
const playedVideo = ({ media, title }: PlayedVideoProps): Played => {
  const item = media?.item ?? null
  const show = item?.show ?? null
  if (item && show) {
    return {
      kind: PLAYED_KINDS.episode,
      show: show.title,
      season: item.season,
      episode: item.episode,
      title: item.title,
    }
  }
  if (item) return { kind: PLAYED_KINDS.video, title: item.title, year: item.year }
  return { kind: PLAYED_KINDS.video, title, year: media?.year ?? null }
}

type PlayedOfProps = { row: HistoryRow; media: MediaItem | undefined }

const playedOf = ({ row, media }: PlayedOfProps): Played => {
  if (row.album_id === null || row.track_title === null) {
    return playedVideo({ media, title: row.file_title })
  }
  return {
    kind: PLAYED_KINDS.track,
    title: row.track_title,
    artist: row.artist,
    album: row.album_title ?? '',
    albumId: row.album_id,
    disc: row.disc ?? 1,
    number: row.track_number,
    albumTracks: row.album_tracks ?? 0,
  }
}

type PlayHistoryRepositoryPageProps = {
  /** Whose history: one account's, or null for everyone's. */
  whose: AccountKey | null
  before: HistoryCursor | null
  show: PlayHistoryShow
  limit: number
  /** Libraries the reader may not see: their entries are left out. */
  hidden: readonly number[]
  /** Who reads, for the files' facts. */
  reader: AccountKey
}

type PlayHistoryRepositoryStartListenProps = {
  account: AccountKey
  mediaId: number
  position: number
  at?: Date
}

type PlayHistoryRepositoryReportListenProps = {
  account: AccountKey
  id: number
  position: number
  at?: Date
}

type PageBinding = {
  hidden: string
  limit: number
  startedAt: string
  accountId: string
  id: number
}

type RowsOfProps = {
  whose: AccountKey | null
  show: PlayHistoryShow
  binding: PageBinding
}

/**
 * The play history: a row for every sitting with a video or a track, by
 * account. A video's rows are kept with its plays (`startVideoSitting`, `continueVideoSitting`); a
 * track's are the listens its player starts and reports here.
 */
@Injectable()
export class PlayHistoryRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MediaRepository) private readonly media: MediaRepository,
  ) {}

  private get db() {
    return this.database.db
  }

  private rowsOf({ whose, show, binding }: RowsOfProps): HistoryRow[] {
    const filters = `${SHOW_FILTERS[show]}
      AND m.library_id NOT IN (SELECT value FROM json_each(@hidden))`
    if (whose === null) {
      return this.db
        .prepare<PageBinding, HistoryRow>(
          `${COLUMNS}
            WHERE (h.started_at, h.account_id, h.id) < (@startedAt, @accountId, @id) ${filters}
            ORDER BY h.started_at DESC, h.account_id DESC, h.id DESC
            LIMIT @limit`,
        )
        .all(binding)
    }
    // The account's numbers grow with its start times, so its key is its order.
    return this.db
      .prepare<PageBinding & ByAccount, HistoryRow>(
        `${COLUMNS}
          WHERE h.account_id = @account AND h.id < @id ${filters}
          ORDER BY h.id DESC
          LIMIT @limit`,
      )
      .all({ ...binding, account: whose })
  }

  /** One page of `whose` history, newest first, and the cursor of the page after it. */
  page({
    whose,
    before,
    show,
    limit,
    hidden,
    reader,
  }: PlayHistoryRepositoryPageProps): PlayHistoryPage {
    const from = before ?? NEWEST
    const rows = this.rowsOf({
      whose,
      show,
      binding: {
        hidden: JSON.stringify(hidden),
        limit: limit + 1,
        startedAt: from.startedAt,
        accountId: from.accountId,
        id: from.id,
      },
    })
    const shown = rows.slice(0, limit)
    const videos = new Map(
      this.media
        .getMany({
          ids: shown.filter((row) => row.album_id === null).map((row) => row.media_id),
          account: reader,
        })
        .map((item) => [item.id, item]),
    )
    const entries = shown.map((row): PlayHistoryEntry => ({
      id: row.id,
      accountId: row.account_id,
      mediaId: row.media_id,
      startedAt: row.started_at,
      lastPlayedAt: row.last_played_at,
      furthest: row.furthest,
      duration: row.duration,
      libraryId: row.library_id,
      libraryName: row.library_name,
      played: playedOf({ row, media: videos.get(row.media_id) }),
    }))
    const last = shown.at(-1)
    const next =
      rows.length > limit && last
        ? cursorText({ startedAt: last.started_at, accountId: last.account_id, id: last.id })
        : null
    return { entries, next }
  }

  /** A track started playing: a new entry for it, numbered; null when `mediaId` is no track. */
  startListen({
    account,
    mediaId,
    position,
    at = new Date(),
  }: PlayHistoryRepositoryStartListenProps): number | null {
    return this.db.transaction((): number | null => {
      const isTrack = !!this.db
        .prepare<[number], { media_id: number }>('SELECT media_id FROM tracks WHERE media_id = ?')
        .get(mediaId)
      if (!isTrack) return null
      const next = this.db
        .prepare<ByAccount, { id: number }>(`SELECT ${NEXT_HISTORY_ID} AS id`)
        .get({ account })
      const id = next?.id ?? 1
      const when = at.toISOString()
      this.db
        .prepare<[ByAccount, number, number, string, string, number]>(
          `INSERT INTO play_history (account_id, id, media_id, started_at, last_played_at, furthest)
           VALUES (@account, ?, ?, ?, ?, ?)`,
        )
        .run({ account }, id, mediaId, when, when, position)
      return id
    })()
  }

  /** A listen got to `position`; false when the account started no such listen. */
  reportListen({
    account,
    id,
    position,
    at = new Date(),
  }: PlayHistoryRepositoryReportListenProps): boolean {
    const { changes } = this.db
      .prepare<[ByAccount, string, number, number]>(
        `UPDATE play_history SET last_played_at = ?, furthest = MAX(COALESCE(furthest, 0), ?)
          WHERE account_id = @account AND id = ? AND play_id IS NULL`,
      )
      .run({ account }, at.toISOString(), position, id)
    return changes > 0
  }
}
