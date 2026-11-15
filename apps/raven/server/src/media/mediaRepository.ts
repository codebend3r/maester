import { Inject, Injectable } from '@nestjs/common'
import {
  DEFAULT_SAGA_BACKDROP,
  ITEM_TYPES,
  type ItemSummary,
  LIBRARY_BACKDROP_TYPES,
  type LibraryBackdrop,
  MATCH_STATES,
  MEDIA_SORTS,
  type MediaItem,
  type MediaSort,
  type PosterEntry,
  type Saga,
  type ShowEntry,
  THUMBNAIL_STATES,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import {
  EPISODE_FILES,
  FAVOURITE,
  FROM_MEDIA,
  IN_PROGRESS,
  type MediaRow,
  ORDER_BY,
  SELECT_COLUMNS,
  SELECT_MEDIA,
  SHOW_ORDER_BY,
  type ShowRow,
  sqlLimit,
  toItem,
} from '@/media/mediaRows'
import { BEST_FIRST, FIRST_ITEM, fileWatched, likePattern, score } from '@/media/mediaSql'
import { SagaBackdrops } from '@/media/sagaBackdrops'
import { shuffle } from '@/media/shuffle'
import type { AccountKey, ByAccount } from '@/media/viewingAccountKeys'
import { ItemImagesRepository } from '@/metadata/itemImagesRepository'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { MusicRepository } from '@/music/musicRepository'

/** A card's library and the item on it, if any. */
type CardItem = { libraryId: number; itemId: number | null }

/** The items one library's cards hold. */
type LibraryItems = { ids: number[]; libraryId: number }

type InEachLibraryProps = {
  entries: readonly CardItem[]
  /** The summaries of `ids` as `libraryId`'s cards show them, keyed by id. */
  lookup: (asked: LibraryItems) => Map<number, ItemSummary>
}

/**
 * Each entry's item as its own library shows it, in order: `lookup` runs
 * once per library, since each can choose its own pictures for a title.
 */
const inEachLibrary = ({ entries, lookup }: InEachLibraryProps): Array<ItemSummary | null> => {
  const byLibrary = new Map(
    [...new Set(entries.map((entry) => entry.libraryId))].map((libraryId) => [
      libraryId,
      lookup({
        libraryId,
        ids: entries.flatMap((entry) =>
          entry.libraryId === libraryId && entry.itemId != null ? [entry.itemId] : [],
        ),
      }),
    ]),
  )
  return entries.map(({ libraryId, itemId }) =>
    itemId == null ? null : (byLibrary.get(libraryId)?.get(itemId) ?? null),
  )
}

type MediaRepositoryGetManyProps = { ids: readonly number[]; account: AccountKey }

type MediaRepositoryGetProps = { id: number; account: AccountKey }

type MediaRepositoryListProps = {
  libraryId: number
  search?: string
  sort?: MediaSort
  seed?: number
  limit?: number
  account: AccountKey
}

type MediaRepositoryNextUnwatchedProps = {
  showIds: readonly number[]
  libraryIds: readonly number[]
  account: AccountKey
}

type MediaRepositoryListShowsProps = {
  libraryId: number
  search?: string
  sort?: MediaSort
  seed?: number
  limit?: number
  /** Only these shows; null lists them all. */
  showIds?: readonly number[] | null
  account: AccountKey
}

type MediaRepositoryNewestReleasedProps = {
  libraryId: number
  type: typeof ITEM_TYPES.movie | typeof ITEM_TYPES.show
  limit: number
}

type MediaRepositoryNextEpisodeProps = {
  showId: number
  libraryIds: readonly number[]
  account: AccountKey
}

type MediaRepositoryWatchedEpisodesProps = {
  ids: readonly number[]
  account: AccountKey
}

type MediaRepositoryListUnmatchedProps = {
  libraryId: number
  search?: string
  account: AccountKey
}

type MediaRepositoryForItemProps = { itemId: number; account: AccountKey }

type MediaRepositoryForItemsProps = {
  itemIds: readonly number[]
  account: AccountKey
}

type MediaRepositoryListInProgressProps = {
  libraryId?: number | null
  account: AccountKey
}

type MediaRepositoryListFavouritesProps = {
  libraryId?: number | null
  account: AccountKey
}

type MediaRepositoryListSagasProps = { libraryId: number; account: AccountKey }

type MediaRepositoryCountInProgressProps = { libraryId: number; account: AccountKey }

type MediaRepositoryNextUpProps = { libraryId: number | null; account: AccountKey }

type NextUpShowRow = { show_id: number; library_id: number; last_played_at: string }

/** A video in progress, with when its spot was last saved. */
type InProgressRow = MediaRow & { progress_at: string }

type DatedVideo = { media: MediaItem; at: string }

/** A next-up episode's file, before it is read. */
type DatedId = { mediaId: number; at: string }

type MediaRepositoryCountFavouritesProps = { libraryId: number; account: AccountKey }

type MediaRepositoryCountWhereProps = { where: string; libraryId: number; account: AccountKey }

type MediaRepositorySagaGroupsProps = { libraryId: number; account: AccountKey }

/** A saga as its movies make it, before the library's pick of backdrop is put on it. */
type SagaGroup = Omit<Saga, 'backdrop'>

/** A watched episode, once for each library that holds one of its files. */
type WatchedEpisode = { episodeId: number; libraryId: number }

/**
 * The videos as a client sees them: listings, a show's next episode, an
 * item's files, favourites. Each read is one account's, whose spots,
 * favourites and plays it binds as `@account`. Every answer is a
 * `MediaItem`, which has no path, so nothing read here can hand a client
 * one. What the server needs of a file itself, its path above all, is
 * `MediaIndex`'s.
 */
@Injectable()
export class MediaRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(ItemImagesRepository) private readonly images: ItemImagesRepository,
    @Inject(SagaBackdrops) private readonly sagaBackdrops: SagaBackdrops,
    @Inject(MusicRepository) private readonly music: MusicRepository,
  ) {}

  private get db() {
    return this.database.db
  }

  /**
   * Items for rows, each with its item's summary attached, as its own
   * library shows it: a title in two libraries can have two posters.
   */
  private items(rows: readonly MediaRow[]): MediaItem[] {
    const summaries = inEachLibrary({
      entries: rows.map((row) => ({ libraryId: row.library_id, itemId: row.item_id })),
      lookup: (asked) => this.metadata.summaries(asked),
    })
    const albums = this.music.albumsOfMedia(rows.map((row) => row.id))
    return rows.map((row, index) => ({
      ...toItem(row),
      item: summaries[index] ?? null,
      album: albums.get(row.id) ?? null,
    }))
  }

  /**
   * The videos with these ids, in the order asked, as `account` sees them;
   * one that is gone is left out.
   */
  getMany({ ids, account }: MediaRepositoryGetManyProps): MediaItem[] {
    if (ids.length === 0) return []
    const found = new Map(
      this.items(
        this.db
          .prepare<[ByAccount, string], MediaRow>(
            `${SELECT_MEDIA} WHERE m.id IN (SELECT value FROM json_each(?))`,
          )
          .all({ account }, JSON.stringify(ids)),
      ).map((item) => [item.id, item]),
    )
    return ids.flatMap((id) => found.get(id) ?? [])
  }

  get({ id, account }: MediaRepositoryGetProps): MediaItem | null {
    return this.getMany({ ids: [id], account })[0] ?? null
  }

  /**
   * A library's videos in `sort` order; `seed` decides a random one, and
   * `limit` keeps the first that many. A movie kept as several files is one
   * entry, its best file, with `versions` saying how many there are, unless
   * its files were split apart into a card each or one for each cut. Search
   * matches the file's title and its movie's.
   */
  list({
    libraryId,
    search = '',
    sort = MEDIA_SORTS.title,
    seed = 0,
    limit,
    account,
  }: MediaRepositoryListProps): MediaItem[] {
    const pattern = likePattern(search.trim())
    const rows = this.db
      .prepare<[ByAccount, number, string, string, string, number], MediaRow>(
        `WITH listed AS (
           ${SELECT_COLUMNS},
                  ROW_NUMBER() OVER (
                    PARTITION BY CASE WHEN i.type = '${ITEM_TYPES.movie}' THEN i.id || '|' || COALESCE(m.split, '')
                                      ELSE -m.id END
                    ORDER BY ${BEST_FIRST}) AS version_rank
           ${FROM_MEDIA}
            WHERE m.library_id = ?)
         SELECT * FROM listed
          WHERE version_rank = 1
            AND (title LIKE ? ESCAPE '\\' OR item_title LIKE ? ESCAPE '\\'
                 OR item_original_title LIKE ? ESCAPE '\\')
          ORDER BY ${ORDER_BY[sort]}
          LIMIT ?`,
      )
      .all({ account }, libraryId, pattern, pattern, pattern, sqlLimit({ sort, limit }))
    const items = this.items(rows)
    return sort === MEDIA_SORTS.random ? shuffle({ items, seed }).slice(0, limit) : items
  }

  /**
   * Each show's first episode not yet watched, by the measure of the library
   * holding the file (specials last, the best file of an episode first), as
   * show id to media id. An episode is watched when any of its files in
   * `libraryIds` is, so a watched 1080p hides its unwatched 720p. A show with
   * every episode watched has none.
   */
  private nextUnwatched({
    showIds,
    libraryIds,
    account,
  }: MediaRepositoryNextUnwatchedProps): Map<number, number> {
    const rows = this.db
      .prepare<[ByAccount, string, string], { show_id: number; media_id: number }>(
        `WITH files AS (
           SELECT s.parent_id AS show_id, m.id AS media_id, e.id AS episode_id,
                  s.number AS season_number, e.number AS episode_number,
                  COALESCE(m.width * m.height, 0) AS pixels,
                  ${fileWatched('m')} AS watched
             FROM media m
             JOIN libraries l ON l.id = m.library_id
             JOIN media_items mi ON mi.media_id = m.id
             JOIN shown_items e ON e.id = mi.item_id AND e.type = '${ITEM_TYPES.episode}'
             JOIN shown_items s ON s.id = e.parent_id
            WHERE s.parent_id IN (SELECT value FROM json_each(?))
              AND m.library_id IN (SELECT value FROM json_each(?))),
         episodes AS (
           SELECT *, MAX(watched) OVER (PARTITION BY episode_id) AS episode_watched FROM files),
         ranked AS (
           SELECT show_id, media_id,
                  ROW_NUMBER() OVER (
                    PARTITION BY show_id
                    ORDER BY season_number = 0, season_number, episode_number, pixels DESC, media_id
                  ) AS rank
             FROM episodes
            WHERE episode_watched = 0)
         SELECT show_id, media_id FROM ranked WHERE rank = 1`,
      )
      .all({ account }, JSON.stringify(showIds), JSON.stringify(libraryIds))
    return new Map(rows.map((row) => [row.show_id, row.media_id]))
  }

  /**
   * A TV library as its shows: how many episodes each has on disk, when
   * its newest file came, its files' mean bitrate, and the first episode
   * not yet watched by the library's measure (specials last). Search
   * matches show titles, and `limit` keeps the first that many.
   */
  listShows({
    libraryId,
    search = '',
    sort = MEDIA_SORTS.title,
    seed = 0,
    limit,
    showIds = null,
    account,
  }: MediaRepositoryListShowsProps): ShowEntry[] {
    const pattern = likePattern(search.trim())
    const only = showIds == null ? null : JSON.stringify(showIds)
    const rows = this.db
      .prepare<[ByAccount, number, string | null, string | null, string, string, number], ShowRow>(
        `WITH files AS (${EPISODE_FILES})
         SELECT sh.id, sh.ended, COUNT(DISTINCT f.episode_id) AS episodes,
                (SELECT COUNT(*) FROM items s WHERE s.parent_id = sh.id AND s.type = '${ITEM_TYPES.season}') AS seasons,
                (SELECT COUNT(*) FROM items e JOIN items s ON s.id = e.parent_id
                  WHERE s.parent_id = sh.id AND s.type = '${ITEM_TYPES.season}' AND e.type = '${ITEM_TYPES.episode}') AS total_episodes,
                COUNT(DISTINCT CASE WHEN f.watched = 1 THEN f.episode_id END) AS watched_episodes,
                MAX(f.added_at) AS added_at,
                MAX(f.changed_at) AS changed_at, AVG(f.bitrate) AS bitrate,
                ${score({ item: 'sh.id', source: 'l.ratings_source' })} AS score
           FROM files f
           JOIN shown_items sh ON sh.id = f.show_id
           JOIN libraries l ON l.id = f.library_id
          WHERE sh.title LIKE ? ESCAPE '\\' OR sh.original_title LIKE ? ESCAPE '\\'
          GROUP BY sh.id
          ORDER BY ${SHOW_ORDER_BY[sort]}
          LIMIT ?`,
      )
      .all({ account }, libraryId, only, only, pattern, pattern, sqlLimit({ sort, limit }))
    const listedIds = rows.map((row) => row.id)
    const summaries = this.metadata.summaries({ ids: listedIds, libraryId })
    const next = this.nextUnwatched({ showIds: listedIds, libraryIds: [libraryId], account })
    const episodes = new Map(
      this.getMany({ ids: [...next.values()], account }).map((item) => [item.id, item]),
    )
    const entries = rows.flatMap((row): ShowEntry[] => {
      const show = summaries.get(row.id)
      if (!show) return []
      const nextId = next.get(row.id)
      return [
        {
          show,
          episodes: row.episodes,
          seasons: row.seasons,
          totalEpisodes: row.total_episodes,
          watchedEpisodes: row.watched_episodes,
          endedYear: row.ended == null ? null : Number(row.ended.slice(0, 4)) || null,
          addedAt: row.added_at,
          bitrate: row.bitrate == null ? null : Math.round(row.bitrate),
          next: (nextId == null ? null : episodes.get(nextId)) ?? null,
        },
      ]
    })
    return sort === MEDIA_SORTS.random ? shuffle({ items: entries, seed }).slice(0, limit) : entries
  }

  /**
   * The ids of a library's matched movies, or of its shows, the most
   * recently released first (a title with no date goes by its year, one with
   * neither goes last), at most `limit`. A read of the matched items alone,
   * so the hero costs none of a listing's per-file work.
   */
  newestReleased({ libraryId, type, limit }: MediaRepositoryNewestReleasedProps): number[] {
    const held =
      type === ITEM_TYPES.movie
        ? `SELECT mi.item_id AS id
             FROM media m JOIN media_items mi ON mi.media_id = m.id
            WHERE m.library_id = ?`
        : `SELECT s.parent_id AS id
             FROM media m
             JOIN media_items mi ON mi.media_id = m.id
             JOIN shown_items e ON e.id = mi.item_id AND e.type = '${ITEM_TYPES.episode}'
             JOIN shown_items s ON s.id = e.parent_id
            WHERE m.library_id = ?`
    return this.db
      .prepare<[number, string, number], { id: number }>(
        `WITH held AS (${held}),
              released AS (
                SELECT i.id, i.sort_title,
                       COALESCE(i.released, CAST(i.year AS TEXT)) AS released
                  FROM shown_items i
                 WHERE i.id IN (SELECT id FROM held) AND i.type = ?)
         SELECT id FROM released
          ORDER BY released IS NULL, released DESC, sort_title COLLATE NOCASE, id
          LIMIT ?`,
      )
      .all(libraryId, type, limit)
      .map((row) => row.id)
  }

  /**
   * The first episode of a show not yet watched, by the measure of whichever
   * of `libraryIds` holds the file, specials last; null once every one is.
   */
  nextEpisode({ showId, libraryIds, account }: MediaRepositoryNextEpisodeProps): MediaItem | null {
    const next = this.nextUnwatched({ showIds: [showId], libraryIds, account }).get(showId)
    return next == null ? null : this.get({ id: next, account })
  }

  /**
   * The episodes among `ids` that `account` watched, each once for every
   * library where one of its files is: a page counts only the libraries it
   * may show.
   */
  watchedEpisodes({ ids, account }: MediaRepositoryWatchedEpisodesProps): WatchedEpisode[] {
    if (ids.length === 0) return []
    return this.db
      .prepare<[ByAccount, string], { episode_id: number; library_id: number }>(
        `SELECT DISTINCT mi.item_id AS episode_id, m.library_id
           FROM media_items mi
           JOIN media m ON m.id = mi.media_id
           JOIN libraries l ON l.id = m.library_id
          WHERE mi.item_id IN (SELECT value FROM json_each(?)) AND ${fileWatched('m')}`,
      )
      .all({ account }, JSON.stringify(ids))
      .map((row) => ({ episodeId: row.episode_id, libraryId: row.library_id }))
  }

  /** A library's files no show or movie was found for, pending ones included, by title. */
  listUnmatched({
    libraryId,
    search = '',
    account,
  }: MediaRepositoryListUnmatchedProps): MediaItem[] {
    return this.items(
      this.db
        .prepare<[ByAccount, number, string], MediaRow>(
          `${SELECT_MEDIA}
            WHERE m.library_id = ? AND m.match IN ('${MATCH_STATES.pending}', '${MATCH_STATES.unmatched}')
              AND m.title LIKE ? ESCAPE '\\'
            ORDER BY m.title COLLATE NOCASE, m.id`,
        )
        .all({ account }, libraryId, likePattern(search.trim())),
    )
  }

  /** Every file that is an item, in any library, best first. */
  forItem({ itemId, account }: MediaRepositoryForItemProps): MediaItem[] {
    return this.forItems({ itemIds: [itemId], account }).get(itemId) ?? []
  }

  /** Every file that is each of the items, in any library, best first, in one read. */
  forItems({ itemIds, account }: MediaRepositoryForItemsProps): Map<number, MediaItem[]> {
    if (itemIds.length === 0) return new Map()
    const rows = this.db
      .prepare<[ByAccount, string], MediaRow & { linked_item: number }>(
        `${SELECT_COLUMNS}, x.item_id AS linked_item${FROM_MEDIA}
           JOIN media_items x ON x.media_id = m.id
          WHERE x.item_id IN (SELECT value FROM json_each(?))
          ORDER BY ${BEST_FIRST}`,
      )
      .all({ account }, JSON.stringify(itemIds))
    const items = this.items(rows)
    return rows.reduce((byItem, row, index) => {
      const item = items[index]
      if (!item) return byItem
      return byItem.set(row.linked_item, [...(byItem.get(row.linked_item) ?? []), item])
    }, new Map<number, MediaItem[]>())
  }

  /**
   * Every video `account` has a saved spot in, across every library that
   * saves progress or in `libraryId` alone, then the next episode of each
   * show it is partway through (`nextUp`), the most recently watched first.
   * A finished or barely started video has no spot, so it is not in
   * progress itself.
   */
  listInProgress({ libraryId = null, account }: MediaRepositoryListInProgressProps): MediaItem[] {
    const rows = this.db
      .prepare<{ libraryId: number | null; account: AccountKey }, InProgressRow>(
        `${SELECT_COLUMNS}, p.updated_at AS progress_at${FROM_MEDIA} WHERE ${IN_PROGRESS}
            AND (@libraryId IS NULL OR m.library_id = @libraryId)
          ORDER BY p.updated_at DESC, m.id DESC`,
      )
      .all({ libraryId, account })
    const started = this.items(rows)
    const upNext = this.nextUp({ libraryId, account })
    if (upNext.length === 0) return started
    const dated = started.map((media, index): DatedVideo => ({
      media,
      at: rows[index]?.progress_at ?? '',
    }))
    return [...dated, ...upNext]
      .toSorted((a, b) => b.at.localeCompare(a.at))
      .map(({ media }) => media)
  }

  /**
   * The first unwatched episode of each show `account` has watched an episode
   * of, in a library that saves progress, unless an episode of the show is
   * in progress already: it keeps a binge going from the start of the next
   * episode. Each comes with when the show was last watched, and starts from
   * the beginning. It starts from the account's own plays, the few hundred
   * rows the watched files are among, never from every episode in the
   * database: begun there, the walk took seconds a library on a large one.
   * The shows in progress keep no null, since one would make NOT IN null for
   * every row; their chain is spelled out again rather than shared in a CTE,
   * which SQLite planned by the titles' type index without statistics.
   */
  private nextUpIds({ libraryId, account }: MediaRepositoryNextUpProps): DatedId[] {
    const shows = this.db
      .prepare<{ libraryId: number | null; account: AccountKey }, NextUpShowRow>(
        `WITH played AS (
           SELECT DISTINCT pl.media_id FROM plays pl WHERE pl.account_id = @account
         ),
         watching AS (
           SELECT DISTINCT ps.parent_id AS show_id
             FROM playback_progress pp
             JOIN media pm ON pm.id = pp.media_id
             JOIN libraries pl2 ON pl2.id = pm.library_id
             JOIN media_items pmi ON pmi.media_id = pp.media_id
             JOIN shown_items pe ON pe.id = pmi.item_id AND pe.type = '${ITEM_TYPES.episode}'
             JOIN shown_items ps ON ps.id = pe.parent_id
            WHERE pp.account_id = @account AND pl2.save_progress = 1
              AND ps.parent_id IS NOT NULL
         )
         SELECT s.parent_id AS show_id, m.library_id,
                MAX((SELECT MAX(pl.played_at) FROM plays pl
                      WHERE pl.account_id = @account AND pl.media_id = m.id)) AS last_played_at
           FROM played w
           JOIN media m ON m.id = w.media_id
           JOIN libraries l ON l.id = m.library_id
           JOIN media_items mi ON mi.media_id = m.id
           JOIN shown_items e ON e.id = mi.item_id AND e.type = '${ITEM_TYPES.episode}'
           JOIN shown_items s ON s.id = e.parent_id
          WHERE l.save_progress = 1
            AND (@libraryId IS NULL OR m.library_id = @libraryId)
            AND ${fileWatched('m')}
            AND s.parent_id NOT IN (SELECT show_id FROM watching)
          GROUP BY s.parent_id, m.library_id`,
      )
      .all({ libraryId, account })
    if (shows.length === 0) return []
    const lastWatched = shows.reduce(
      (latest, row) =>
        (latest.get(row.show_id) ?? '') >= row.last_played_at
          ? latest
          : latest.set(row.show_id, row.last_played_at),
      new Map<number, string>(),
    )
    const next = this.nextUnwatched({
      showIds: [...lastWatched.keys()],
      libraryIds: [...new Set(shows.map((row) => row.library_id))],
      account,
    })
    return [...next].map(([showId, mediaId]) => ({ mediaId, at: lastWatched.get(showId) ?? '' }))
  }

  /** `nextUpIds`' episodes, each to start from the beginning. */
  private nextUp(props: MediaRepositoryNextUpProps): DatedVideo[] {
    const dated = this.nextUpIds(props)
    const episodes = new Map(
      this.getMany({ ids: dated.map(({ mediaId }) => mediaId), account: props.account }).map(
        (item) => [item.id, item],
      ),
    )
    return dated.flatMap(({ mediaId, at }): DatedVideo[] => {
      const media = episodes.get(mediaId)
      return media ? [{ media: { ...media, position: 0 }, at }] : []
    })
  }

  /**
   * What stands for a library on the Libraries page: the backdrop of its
   * newest video's movie or show, by `ItemImagesRepository.backdropFor`, else
   * that video's thumbnail once it is made. Asked for every library each
   * time the page polls, so it reads that one file and nothing of a listing.
   */
  backdropOf(libraryId: number): LibraryBackdrop | null {
    const newest = this.db
      .prepare<
        [number],
        { id: number; thumbnail: string; mtime_ms: number; item_id: number | null }
      >(
        `SELECT m.id, m.thumbnail, m.mtime_ms,
                (SELECT MIN(mi.item_id) FROM media_items mi WHERE mi.media_id = m.id) AS item_id
           FROM media m
          WHERE m.library_id = ?
          ORDER BY m.added_at DESC, m.id DESC
          LIMIT 1`,
      )
      .get(libraryId)
    if (!newest) return null
    const backdrop =
      newest.item_id == null ? null : this.images.backdropFor({ itemId: newest.item_id, libraryId })
    if (backdrop) return { type: LIBRARY_BACKDROP_TYPES.item, ...backdrop }
    return newest.thumbnail === THUMBNAIL_STATES.ready
      ? { type: LIBRARY_BACKDROP_TYPES.thumbnail, id: newest.id, version: newest.mtime_ms }
      : null
  }

  /**
   * Each video with the item whose poster its card shows, by
   * `MetadataRepository.posterItems`, as the video's own library shows it.
   */
  withPosters(videos: readonly MediaItem[]): PosterEntry[] {
    const posters = inEachLibrary({
      entries: videos.map((media) => ({
        libraryId: media.libraryId,
        itemId: media.item?.id ?? null,
      })),
      lookup: (asked) => this.metadata.posterItems(asked),
    })
    return videos.map((media, index) => ({ media, poster: posters[index] ?? null }))
  }

  /**
   * Every favourite of `account` across every library, or in `libraryId`
   * alone, most recently marked first. A locked library's are left out,
   * whether or not the PIN is entered.
   */
  listFavourites({ libraryId = null, account }: MediaRepositoryListFavouritesProps): MediaItem[] {
    return this.items(
      this.db
        .prepare<{ libraryId: number | null; account: AccountKey }, MediaRow>(
          `${SELECT_MEDIA} WHERE ${FAVOURITE}
              AND (@libraryId IS NULL OR m.library_id = @libraryId)
            ORDER BY f.added_at DESC, m.id DESC`,
        )
        .all({ libraryId, account }),
    )
  }

  /** How many of a library's videos match `where`, over the same rows its listings read. */
  private countWhere({ where, libraryId, account }: MediaRepositoryCountWhereProps): number {
    return (
      this.db
        .prepare<[ByAccount, number], { count: number }>(
          `SELECT COUNT(*) AS count${FROM_MEDIA} WHERE ${where} AND m.library_id = ?`,
        )
        .get({ account }, libraryId)?.count ?? 0
    )
  }

  /** How many videos `listInProgress` lists for the library, without reading them. */
  countInProgress({ libraryId, account }: MediaRepositoryCountInProgressProps): number {
    return (
      this.countWhere({ where: IN_PROGRESS, libraryId, account }) +
      this.nextUpIds({ libraryId, account }).length
    )
  }

  /** How many videos `listFavourites` lists for the library, without reading them. */
  countFavourites({ libraryId, account }: MediaRepositoryCountFavouritesProps): number {
    return this.countWhere({ where: FAVOURITE, libraryId, account })
  }

  /**
   * Each TMDB collection two or more of a library's movies belong to, with
   * those movies oldest first, one entry each, its best file. A movie split
   * onto several cards is still one movie, so a single movie of a
   * collection is no saga yet, however many cards it has.
   */
  sagaGroups({ libraryId, account }: MediaRepositorySagaGroupsProps): SagaGroup[] {
    const movies = this.items(
      this.db
        .prepare<[ByAccount, number], MediaRow>(
          `WITH ranked AS (
             ${SELECT_COLUMNS},
                    ROW_NUMBER() OVER (PARTITION BY i.id ORDER BY ${BEST_FIRST}) AS version_rank
             ${FROM_MEDIA}
              WHERE m.library_id = ? AND i.type = '${ITEM_TYPES.movie}' AND t.saga_tmdb_id IS NOT NULL)
           SELECT * FROM ranked WHERE version_rank = 1 ORDER BY ${ORDER_BY[MEDIA_SORTS.yearOld]}`,
        )
        .all({ account }, libraryId),
    )
    const sagas = this.metadata.sagasOf(movies.flatMap((media) => media.item?.id ?? []))
    const grouped = movies.reduce((groups, media) => {
      const saga = media.item ? sagas.get(media.item.id) : undefined
      if (!saga) return groups
      const held = groups.get(saga.tmdbId)?.media ?? []
      return groups.set(saga.tmdbId, { ...saga, media: [...held, media] })
    }, new Map<string, SagaGroup>())
    return [...grouped.values()].filter((saga) => saga.media.length > 1)
  }

  /** A library's sagas, by name, each with the backdrop the library picked for it. */
  listSagas({ libraryId, account }: MediaRepositoryListSagasProps): Saga[] {
    const backdrops = this.sagaBackdrops.ofLibrary(libraryId)
    return this.sagaGroups({ libraryId, account })
      .map((saga) => ({ ...saga, backdrop: backdrops.get(saga.tmdbId) ?? DEFAULT_SAGA_BACKDROP }))
      .toSorted((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * How many sagas `listSagas` lists for the library, without reading its
   * movies: the collections two or more of its matched movies are in.
   */
  countSagas(libraryId: number): number {
    return (
      this.db
        .prepare<[number], { count: number }>(
          `SELECT COUNT(*) AS count FROM (
             SELECT t.saga_tmdb_id
               FROM media m
               JOIN ${FIRST_ITEM}
               JOIN shown_items i ON i.id = mi.item_id
               JOIN items t ON t.id = mi.item_id
              WHERE m.library_id = ? AND i.type = '${ITEM_TYPES.movie}'
                AND t.saga_tmdb_id IS NOT NULL AND t.saga_name IS NOT NULL
              GROUP BY t.saga_tmdb_id
             HAVING COUNT(DISTINCT i.id) > 1)`,
        )
        .get(libraryId)?.count ?? 0
    )
  }
}
