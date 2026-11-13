import { Inject, Injectable } from '@nestjs/common'
import {
  type MediaItem,
  SESSION_KINDS,
  SHUFFLE_LENGTH,
  type ViewingSession,
  shuffled,
  ITEM_TYPES,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import { MediaRepository } from '@/media/mediaRepository'
import { fileWatched } from '@/media/mediaSql'
import type { AccountKey, ByAccount } from '@/media/viewingAccountKeys'

type WatchNextNextInSessionProps = {
  media: MediaItem
  session: ViewingSession
  /** The libraries the viewer may see, where a shuffle draws its episodes from. */
  libraryIds: readonly number[]
  roll?: () => number
  account: AccountKey
}

type WatchNextNextInShowProps = {
  mediaId: number
  libraryId: number
  isSeasonOnly: boolean
  account: AccountKey
}

type WatchNextNextShuffledProps = {
  mediaId: number
  showId: number
  libraryIds: readonly number[]
  roll: () => number
  account: AccountKey
}

type WatchNextNextInSagaProps = {
  media: MediaItem
  sagaId: string
  account: AccountKey
}

type WatchNextShuffledEpisodesProps = {
  itemId: number
  libraryIds: readonly number[]
  roll?: () => number
  account: AccountKey
}

/** What plays next in a viewing session, and a show's or season's episodes dealt for a shuffle. */
@Injectable()
export class WatchNext {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MediaRepository) private readonly media: MediaRepository,
  ) {}

  private get db() {
    return this.database.db
  }

  /**
   * What plays after `media` in `session`, from the same library: the next
   * episode of its season or its show, or the next film of its saga; a
   * shuffle draws from every library in `libraryIds` with `roll`. Null at
   * the session's end, and for a session whose next is not the server's.
   */
  nextInSession({
    media,
    session,
    libraryIds,
    roll = Math.random,
    account,
  }: WatchNextNextInSessionProps): MediaItem | null {
    switch (session.kind) {
      case SESSION_KINDS.season:
      case SESSION_KINDS.show:
        return this.nextInShow({
          mediaId: media.id,
          libraryId: media.libraryId,
          isSeasonOnly: session.kind === SESSION_KINDS.season,
          account,
        })
      case SESSION_KINDS.saga:
        return this.nextInSaga({ media, sagaId: session.sagaId, account })
      case SESSION_KINDS.shuffle:
        return this.nextShuffled({
          mediaId: media.id,
          showId: Number(session.showId),
          libraryIds,
          roll,
          account,
        })
      case SESSION_KINDS.single:
      case SESSION_KINDS.queue:
        return null
      default: {
        const unknown: never = session
        return unknown
      }
    }
  }

  /**
   * The best file in `libraryId` of the episode after `mediaId`'s, in show
   * order: specials last, then by season and episode. A file of several
   * episodes counts as its last. `isSeasonOnly` stops at its season's end.
   */
  private nextInShow({
    mediaId,
    libraryId,
    isSeasonOnly,
    account,
  }: WatchNextNextInShowProps): MediaItem | null {
    const row = this.db
      .prepare<{ mediaId: number; libraryId: number; isSeasonOnly: number }, { media_id: number }>(
        `WITH current AS (
           SELECT s.id AS season_id, s.parent_id AS show_id,
                  s.number AS season_number, e.number AS episode_number
             FROM media_items mi
             JOIN shown_items e ON e.id = mi.item_id AND e.type = '${ITEM_TYPES.episode}'
             JOIN shown_items s ON s.id = e.parent_id
            WHERE mi.media_id = @mediaId
            ORDER BY s.number = 0 DESC, s.number DESC, e.number DESC
            LIMIT 1),
         files AS (
           SELECT m.id AS media_id, s.number AS season_number, e.number AS episode_number,
                  COALESCE(m.width * m.height, 0) AS pixels
             FROM current c
             JOIN shown_items s ON s.parent_id = c.show_id
                               AND (@isSeasonOnly = 0 OR s.id = c.season_id)
             JOIN shown_items e ON e.parent_id = s.id AND e.type = '${ITEM_TYPES.episode}'
             JOIN media_items mi ON mi.item_id = e.id
             JOIN media m ON m.id = mi.media_id
            WHERE m.library_id = @libraryId)
         SELECT f.media_id
           FROM files f, current c
          WHERE (f.season_number = 0, f.season_number, f.episode_number)
                > (c.season_number = 0, c.season_number, c.episode_number)
          ORDER BY f.season_number = 0, f.season_number, f.episode_number, f.pixels DESC, f.media_id
          LIMIT 1`,
      )
      .get({ mediaId, libraryId, isSeasonOnly: isSeasonOnly ? 1 : 0 })
    return row ? this.media.get({ id: row.media_id, account }) : null
  }

  /**
   * A random episode of show `showId`, any season, specials too, for a
   * shuffle that never ends: never an episode the file `mediaId` holds, and
   * one `account` has not watched while any such remain, else any of the
   * rest. Each episode is as likely as the next, however many files it has,
   * and the best of its files in `libraryIds` is the one, as
   * `shuffledEpisodes` chooses. Null when the show has no other episode.
   */
  private nextShuffled({
    mediaId,
    showId,
    libraryIds,
    roll,
    account,
  }: WatchNextNextShuffledProps): MediaItem | null {
    const rows = this.db
      .prepare<[ByAccount, number, string, number], { media_id: number; watched: number }>(
        `WITH files AS (
           SELECT m.id AS media_id, e.id AS episode_id,
                  COALESCE(m.width * m.height, 0) AS pixels,
                  ${fileWatched('m')} AS watched
             FROM media m
             JOIN libraries l ON l.id = m.library_id
             JOIN media_items mi ON mi.media_id = m.id
             JOIN shown_items e ON e.id = mi.item_id AND e.type = '${ITEM_TYPES.episode}'
             JOIN shown_items s ON s.id = e.parent_id
            WHERE s.parent_id = ?
              AND m.library_id IN (SELECT value FROM json_each(?))
              AND e.id NOT IN (SELECT item_id FROM media_items WHERE media_id = ?)),
         ranked AS (
           SELECT media_id,
                  MAX(watched) OVER (PARTITION BY episode_id) AS watched,
                  ROW_NUMBER() OVER (PARTITION BY episode_id ORDER BY pixels DESC, media_id) AS rank
             FROM files)
         SELECT media_id, watched FROM ranked WHERE rank = 1 ORDER BY media_id`,
      )
      .all({ account }, showId, JSON.stringify(libraryIds), mediaId)
    const unwatched = rows.filter((row) => row.watched === 0)
    const pool = unwatched.length > 0 ? unwatched : rows
    const drawn = pool[Math.floor(roll() * pool.length)]
    return drawn ? this.media.get({ id: drawn.media_id, account }) : null
  }

  /** The film after `media`'s in saga `sagaId` of its library, oldest first, as the saga's page lists them. */
  private nextInSaga({ media, sagaId, account }: WatchNextNextInSagaProps): MediaItem | null {
    const films =
      this.media
        .sagaGroups({ libraryId: media.libraryId, account })
        .find((saga) => saga.tmdbId === sagaId)?.media ?? []
    const at = films.findIndex(
      (film) => film.item != null && film.item.id === (media.item?.id ?? null),
    )
    return at < 0 ? null : (films[at + 1] ?? null)
  }

  /**
   * The episodes on disk under `itemId`, a show or a season, in a random
   * order, `SHUFFLE_LENGTH` at most: every episode is as likely as the next,
   * however many files it has, and the best of its files in `libraryIds` is
   * the one. Empty with no episode there to play. `roll` is the die, 0 up to
   * 1, so a test can load it.
   */
  shuffledEpisodes({
    itemId,
    libraryIds,
    roll = Math.random,
    account,
  }: WatchNextShuffledEpisodesProps): MediaItem[] {
    const rows = this.db
      .prepare<[number, number, string], { media_id: number }>(
        `WITH files AS (
           SELECT m.id AS media_id, e.id AS episode_id, COALESCE(m.width * m.height, 0) AS pixels
             FROM media m
             JOIN media_items mi ON mi.media_id = m.id
             JOIN shown_items e ON e.id = mi.item_id AND e.type = '${ITEM_TYPES.episode}'
             JOIN shown_items s ON s.id = e.parent_id
            WHERE (s.id = ? OR s.parent_id = ?)
              AND m.library_id IN (SELECT value FROM json_each(?))),
         ranked AS (
           SELECT episode_id, media_id,
                  ROW_NUMBER() OVER (PARTITION BY episode_id ORDER BY pixels DESC, media_id) AS rank
             FROM files)
         SELECT media_id FROM ranked WHERE rank = 1 ORDER BY episode_id`,
      )
      .all(itemId, itemId, JSON.stringify(libraryIds))
    const dealt = shuffled({ items: rows.map((row) => row.media_id), roll })
    return this.media.getMany({ ids: dealt.slice(0, SHUFFLE_LENGTH), account })
  }
}
