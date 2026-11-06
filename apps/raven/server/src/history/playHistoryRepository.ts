import { Inject, Injectable } from '@nestjs/common'
import {
  ITEM_TYPES,
  artistNames,
  type MediaItem,
  PLAYED_KINDS,
  PLAY_HISTORY_SHOWS,
  type PlayHistoryEntry,
  type PlayHistoryPage,
  type PlayHistoryShow,
  type Played,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import { PLAY_HISTORY_KINDS } from '@/history/playHistorySql'
import { MediaRepository } from '@/media/mediaRepository'
import { TRACK_ARTISTS, creditsOf } from '@/music/musicRepository'
import type { AccountKey, ByAccount } from '@/media/viewingAccountKeys'
import type { ListenerScope } from '@/music/listenerScope'

/** A first page reads from past the newest entry. */
const NEWEST = Number.MAX_SAFE_INTEGER

type PlayHistoryKind = (typeof PLAY_HISTORY_KINDS)[keyof typeof PLAY_HISTORY_KINDS]

/** The kind of entry each choice of `show` keeps; null keeps every kind. */
const SHOW_KINDS = {
  [PLAY_HISTORY_SHOWS.all]: null,
  [PLAY_HISTORY_SHOWS.video]: PLAY_HISTORY_KINDS.video,
  [PLAY_HISTORY_SHOWS.music]: PLAY_HISTORY_KINDS.listen,
} as const satisfies Record<PlayHistoryShow, PlayHistoryKind | null>

type HistoryRow = {
  account_id: string
  id: number
  kind: PlayHistoryKind
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
  /** The track's artists as a JSON list of `{ id, name }`, in credit order. */
  artists: string
}

const COLUMNS = `
  SELECT h.account_id, h.id, h.kind, h.media_id, h.started_at, h.last_played_at, h.furthest,
         m.duration, m.library_id, l.name AS library_name, m.title AS file_title,
         t.title AS track_title, t.disc, t.number AS track_number,
         a.id AS album_id, a.title AS album_title,
         (SELECT COUNT(*) FROM tracks at WHERE at.album_id = a.id) AS album_tracks,
         ${TRACK_ARTISTS} AS artists
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
      itemId: item.id,
      showId: show.id,
    }
  }
  if (item) {
    return {
      kind: PLAYED_KINDS.video,
      title: item.title,
      year: item.year,
      itemId: item.type === ITEM_TYPES.movie ? item.id : null,
    }
  }
  return { kind: PLAYED_KINDS.video, title, year: media?.year ?? null, itemId: null }
}

type PlayedOfProps = { row: HistoryRow; media: MediaItem | undefined }

/** A listen reads as its track; one whose track has since lost its album reads as its file, as a video does. */
const playedOf = ({ row, media }: PlayedOfProps): Played => {
  if (row.kind === PLAY_HISTORY_KINDS.video || row.album_id === null || row.track_title === null) {
    return playedVideo({ media, title: row.file_title })
  }
  const artists = creditsOf(row.artists)
  return {
    kind: PLAYED_KINDS.track,
    title: row.track_title,
    artist: artists.length > 0 ? artistNames({ artists }) : null,
    artists,
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
  /** The `next` a page before this one answered; null for the newest page. */
  before: number | null
  show: PlayHistoryShow
  limit: number
  /** Who reads, for the files' facts, and the libraries whose entries they may not see. */
  scope: ListenerScope
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
  before: number
  limit: number
  hidden: string
  account: AccountKey | null
  kind: PlayHistoryKind | null
}

/**
 * The play history: a row for every sitting with a video or a track, by
 * account. A video's rows are kept with its plays (`keepVideoSitting`); a
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

  /** One page of `whose` history, newest first, and the cursor of the page after it. */
  page({ whose, before, show, limit, scope }: PlayHistoryRepositoryPageProps): PlayHistoryPage {
    const kind = SHOW_KINDS[show]
    const conditions = [
      'h.id < @before',
      'm.library_id NOT IN (SELECT value FROM json_each(@hidden))',
      ...(whose === null ? [] : ['h.account_id = @account']),
      ...(kind === null ? [] : ['h.kind = @kind']),
    ]
    const rows = this.db
      .prepare<PageBinding, HistoryRow>(
        `${COLUMNS}
          WHERE ${conditions.join(' AND ')}
          ORDER BY h.id DESC
          LIMIT @limit`,
      )
      .all({
        before: before ?? NEWEST,
        limit: limit + 1,
        hidden: JSON.stringify(scope.hidden),
        account: whose,
        kind,
      })
    const shown = rows.slice(0, limit)
    const videos = new Map(
      this.media
        .getMany({
          ids: shown
            .filter((row) => row.kind === PLAY_HISTORY_KINDS.video)
            .map((row) => row.media_id),
          account: scope.account,
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
    const next = rows.length > limit ? (shown.at(-1)?.id ?? null) : null
    return { entries, next }
  }

  /** A track started playing: a new entry for it, numbered; null when `mediaId` is no track. */
  startListen({
    account,
    mediaId,
    position,
    at = new Date(),
  }: PlayHistoryRepositoryStartListenProps): number | null {
    const when = at.toISOString()
    const made = this.db
      .prepare<[ByAccount, string, string, string, number, number]>(
        `INSERT INTO play_history (account_id, kind, media_id, started_at, last_played_at, furthest)
         SELECT @account, ?, media_id, ?, ?, ? FROM tracks WHERE media_id = ?`,
      )
      .run({ account }, PLAY_HISTORY_KINDS.listen, when, when, position, mediaId)
    return made.changes > 0 ? Number(made.lastInsertRowid) : null
  }

  /** A listen got to `position`; false when the account started no such listen. */
  reportListen({
    account,
    id,
    position,
    at = new Date(),
  }: PlayHistoryRepositoryReportListenProps): boolean {
    const { changes } = this.db
      .prepare<[ByAccount, string, number, number, string]>(
        `UPDATE play_history SET last_played_at = ?, furthest = MAX(COALESCE(furthest, 0), ?)
          WHERE id = ? AND account_id = @account AND kind = ?`,
      )
      .run({ account }, at.toISOString(), position, id, PLAY_HISTORY_KINDS.listen)
    return changes > 0
  }
}
