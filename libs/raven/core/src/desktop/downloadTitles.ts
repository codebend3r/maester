import {
  type ItemDetails,
  type ItemSummary,
  ITEM_TYPES,
  type Library,
  type MediaItem,
  RATING_SOURCES,
  type Saga,
} from '@/contract'
import {
  DOWNLOAD_ARTWORK_KINDS,
  DOWNLOAD_KINDS,
  type DownloadArtwork,
  type DownloadCover,
  type DownloadFacts,
  type DownloadGroup,
  type DownloadLibrary,
} from '@/desktop/protocol'
import { artItemIdOf, episodeCode, itemLabel, mediaLabel, pickScore } from '@/items'

/*
 * What a Download button's target comes to, worked out from what the server said of it: the
 * group, the labels, the order, the pictures and the facts. Every host that keeps downloads
 * (Raven's main, a browser) reads the server its own way and builds its files from these, so a
 * title is filed the same wherever it is kept.
 */

/** The most files one ask queues. */
export const DOWNLOAD_MAX_FILES = 500

/** One file of a title, before it takes its place in the title's group. */
export type TitleEntry = { media: MediaItem; label: string; order: number }

type VideoGroup = Exclude<DownloadGroup, { cover: unknown }>

/** A video title to download: its group before each file is ordered in it, and its files. */
export type TitleDraft = {
  title: string
  group: Omit<VideoGroup, 'order'>
  /** The picture every file of the title shows; none leaves each file its own. */
  artwork: DownloadArtwork | null
  entries: TitleEntry[]
}

type EpisodePlace = Pick<ItemSummary, 'season' | 'episode'>

type EpisodeLabelProps = EpisodePlace & Pick<ItemSummary, 'title'>

export const episodeLabel = ({ season, episode, title }: EpisodeLabelProps): string => {
  const code = season === null || episode === null ? null : episodeCode({ season, episode })
  return code === null ? title : `${code} ${title}`
}

const episodeOrder = ({ season, episode }: EpisodePlace): number =>
  (season ?? 0) * 10_000 + (episode ?? 0)

type ShowGroupKeyProps = Pick<ItemSummary, 'id' | 'type' | 'show'>

/** An episode, its season and its show share one group, whichever of them was asked for. */
const showGroupKey = ({ id, type, show }: ShowGroupKeyProps): string => {
  if (type === ITEM_TYPES.show) return `show:${id}`
  // The server names no show only for a season or episode it cannot place under one.
  return show === null ? `item:${id}` : `show:${show.id}`
}

const movieGroupKey = (media: MediaItem): string => `movie:${media.id}`

type PosterOfProps = Pick<ItemSummary, 'id' | 'posterVersion'>

/** An item's poster as the page addresses it, or nothing when the server has none. */
export const posterOf = ({ id, posterVersion }: PosterOfProps): DownloadArtwork =>
  posterVersion === null
    ? { kind: DOWNLOAD_ARTWORK_KINDS.none }
    : { kind: DOWNLOAD_ARTWORK_KINDS.poster, itemId: id, version: posterVersion }

type CoverOfProps = { cover: DownloadCover | null }

/** The album cover a music group shows, or nothing when the server has none. */
export const coverOf = ({ cover }: CoverOfProps): DownloadArtwork =>
  cover === null || cover.coverVersion === null
    ? { kind: DOWNLOAD_ARTWORK_KINDS.none }
    : { kind: DOWNLOAD_ARTWORK_KINDS.cover, albumId: cover.albumId, version: cover.coverVersion }

/** A file's own picture: its movie's or episode's poster. */
export const artworkOfMedia = ({ item }: MediaItem): DownloadArtwork =>
  item === null ? { kind: DOWNLOAD_ARTWORK_KINDS.none } : posterOf(item)

/** What a download keeps of its file so a grid can sort it by any field a library can. */
export const factsOf = (media: MediaItem): DownloadFacts => ({
  year: media.item?.year ?? media.year,
  score:
    media.item === null
      ? null
      : (pickScore({ ratings: media.item.ratings, source: RATING_SOURCES.tmdb })?.value ?? null),
  bitrate: media.bitrate,
  pixels: media.width === null || media.height === null ? null : media.width * media.height,
  addedAt: media.addedAt,
  changedAt: media.changedAt,
})

/** A library as a download keeps it: private when the server holds it behind its PIN. */
export const libraryOf = ({ id, name, settings }: Library): DownloadLibrary => ({
  id,
  name,
  isPrivate: settings.locked,
})

/** The item whose art stands for a file: its show's for an episode, its own for a movie. */
export const titleItemIdOf = ({ item }: MediaItem): number | null =>
  item === null ? null : artItemIdOf(item)

const episodesOf = (details: ItemDetails): TitleEntry[] =>
  details.children.flatMap((child) =>
    child.type === ITEM_TYPES.episode && child.primary !== null
      ? [{ media: child.primary, label: episodeLabel(child), order: episodeOrder(child) }]
      : [],
  )

/** A file asked for by itself: a movie, or an episode under its show. */
export const draftOfMedia = (media: MediaItem): TitleDraft => {
  const item = media.item
  const title = mediaLabel(media)
  if (item === null || item.type !== ITEM_TYPES.episode) {
    return {
      title,
      group: { kind: DOWNLOAD_KINDS.movie, key: movieGroupKey(media), title },
      artwork: null,
      entries: [{ media, label: title, order: 0 }],
    }
  }
  return {
    title,
    group: {
      kind: DOWNLOAD_KINDS.episode,
      key: showGroupKey(item),
      title: item.show?.title ?? item.title,
    },
    artwork: null,
    entries: [{ media, label: episodeLabel(item), order: episodeOrder(item) }],
  }
}

/** The seasons a host reads before it drafts an item: a show's, one after another; none for any other item. */
export const seasonIdsOf = (details: ItemDetails): number[] =>
  details.type === ITEM_TYPES.show
    ? details.children.flatMap((child) => (child.type === ITEM_TYPES.season ? [child.id] : []))
    : []

type DraftOfItemProps = {
  details: ItemDetails
  /** The details of each of `seasonIdsOf(details)`, in that order. */
  seasons: readonly ItemDetails[]
}

/** An item asked for: its first version, a season's episodes, or every season's. Null when it has no file. */
export const draftOfItem = ({ details, seasons }: DraftOfItemProps): TitleDraft | null => {
  const [first] = details.versions
  switch (details.type) {
    case ITEM_TYPES.movie: {
      if (first === undefined) return null
      const draft = draftOfMedia(first)
      return {
        ...draft,
        group: {
          kind: DOWNLOAD_KINDS.movie,
          key: movieGroupKey(first),
          title: draft.group.title,
        },
      }
    }
    case ITEM_TYPES.episode:
      if (first === undefined) return null
      return {
        title: itemLabel(details),
        group: {
          kind: DOWNLOAD_KINDS.episode,
          key: showGroupKey(details),
          title: details.show?.title ?? details.title,
        },
        artwork: null,
        entries: [{ media: first, label: episodeLabel(details), order: episodeOrder(details) }],
      }
    case ITEM_TYPES.season:
      return {
        title: itemLabel(details),
        group: {
          kind: DOWNLOAD_KINDS.season,
          key: showGroupKey(details),
          title: details.show?.title ?? details.title,
        },
        artwork: posterOf(details),
        entries: episodesOf(details),
      }
    case ITEM_TYPES.show:
      return {
        title: details.title,
        group: { kind: DOWNLOAD_KINDS.show, key: showGroupKey(details), title: details.title },
        artwork: posterOf(details),
        entries: seasons.flatMap(episodesOf),
      }
    default: {
      const unreachable: never = details.type
      return unreachable
    }
  }
}

type DraftOfSagaProps = { saga: Saga; libraryId: number }

/** A saga's films, in the saga's order, each wearing its own poster. */
export const draftOfSaga = ({ saga, libraryId }: DraftOfSagaProps): TitleDraft => ({
  title: saga.name,
  group: { kind: DOWNLOAD_KINDS.saga, key: `saga:${libraryId}:${saga.tmdbId}`, title: saga.name },
  artwork: null,
  entries: saga.media.map((media, order) => ({ media, label: mediaLabel(media), order })),
})

/** Both episodes of a two-episode file name that one file as their `primary`: it is fetched once, as the first. */
export const oncePerFile = <E extends Pick<TitleEntry, 'media'>>(entries: readonly E[]): E[] => [
  ...entries
    .reduce(
      (byMedia, entry) =>
        byMedia.has(entry.media.id) ? byMedia : byMedia.set(entry.media.id, entry),
      new Map<number, E>(),
    )
    .values(),
]
