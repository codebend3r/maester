import {
  type ApiClient,
  CARD_DESTINATIONS,
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type ItemSummary,
  type LibraryKind,
  type MediaItem,
  type MediaSort,
  type ShowEntry,
  cardDestination,
  cardTitle,
  formatRuntime,
  matchTypeFor,
  mediaEntryKey,
  mediaLabel,
  progressOf,
  showEntryKey,
  showSortFact,
  showYears,
  sortFact,
} from '@raven/core'

import type { EpisodeWords } from '@/queries/episodeMark'
import { ROUTE_TARGETS, type RouteTarget, itemTarget } from '@/routes'

/** How a card is drawn: a poster stood upright, or a wide frame. */
export const CARD_SHAPES = { poster: 'poster', wide: 'wide', square: 'square' } as const

export type CardShape = (typeof CARD_SHAPES)[keyof typeof CARD_SHAPES]

/** A picture as React Native's `Image` takes it, with the server's cookies where it needs them. */
export type Picture = { uri: string; headers: Record<string, string> }

/** One card, on a shelf or in a grid, as both layouts draw it. */
export type ShelfCard = {
  key: string
  title: string
  line: string | null
  shape: CardShape
  picture: Picture | null
  /** How far in playback stopped, from 0 to 1. */
  progress: number
  /** The show's or film's title art, drawn over the picture where a card wears it. */
  logo?: Picture | null
  /** An episode's own name and place, set under the picture in place of `line`. */
  episode?: EpisodeWords | null
  /** Set on a card that resumes a video: it is drawn as a resume card, with what is left to watch. */
  resume?: { timeLeft: string | null } | null
  /** Where pressing it goes: its item's page, or the player for a file with no page. */
  target: RouteTarget
}

type CardLabelOfProps = { card: Pick<ShelfCard, 'title' | 'episode'> }

/** What a screen reader says of a card: its title, and for an episode its place and name. */
export const cardLabelOf = ({ card }: CardLabelOfProps): string =>
  [card.title, card.episode?.mark ?? null, card.episode?.name ?? null]
    .filter((part): part is string => part !== null)
    .join(', ')

/** Where a card's picture comes from and what goes with the request for it. */
export type Pictures = {
  api: Pick<ApiClient, 'itemImageUrl' | 'thumbnailUrl' | 'photoUrl'>
  headersFor: (uri: string) => Record<string, string>
}

/**
 * The order a grid's cards are listed in, so each says the value it is in order by, and
 * when it is, for the sorts by when files came; null on a shelf, which has no order to explain.
 */
type Order = { sort: MediaSort; now: Date } | null

type PictureAtProps = Pick<Pictures, 'headersFor'> & { uri: string | null }

export const pictureAt = ({ uri, headersFor }: PictureAtProps) =>
  uri === null ? null : { uri, headers: headersFor(uri) }

type ImageOfProps = Pick<Pictures, 'api'> & {
  item: ItemSummary | null
  kind: typeof ITEM_IMAGE_KINDS.poster | typeof ITEM_IMAGE_KINDS.backdrop
}

export const imageOf = ({ api, item, kind }: ImageOfProps): string | null => {
  if (item === null) return null
  const version = kind === ITEM_IMAGE_KINDS.poster ? item.posterVersion : item.backdropVersion
  return api.itemImageUrl({ id: item.id, kind, version })
}

type VideoTargetProps = { media: MediaItem; hasPages: boolean }

/**
 * Where a video's card goes, as the web's card links decide: its item's page in the card's
 * library where `hasPages`, naming the file of a card a movie was split onto, else the player.
 */
const videoTarget = ({ media, hasPages }: VideoTargetProps): RouteTarget => {
  const destination = cardDestination({ media, hasPages })
  switch (destination.kind) {
    case CARD_DESTINATIONS.page:
      return {
        kind: ROUTE_TARGETS.item,
        itemId: destination.item.id,
        libraryId: destination.libraryId,
        fileId: destination.file,
      }
    case CARD_DESTINATIONS.player:
      return { kind: ROUTE_TARGETS.play, mediaId: destination.media.id, at: 0 }
    default: {
      const unknown: never = destination
      return unknown
    }
  }
}

type VideoCardProps = Pick<Pictures, 'headersFor'> & {
  media: MediaItem
  title: string
  line: string | null
  shape: CardShape
  uri: string | null
  hasPages: boolean
}

/**
 * A card for one video: what it shows is the caller's, the rest comes from the video. A card
 * `hasPages` opens its item's page; any other plays the video, as the web's frame cards do.
 */
export const videoCard = ({
  media,
  title,
  line,
  shape,
  uri,
  hasPages,
  headersFor,
}: VideoCardProps): ShelfCard => ({
  key: mediaEntryKey(media),
  title,
  line,
  shape,
  picture: pictureAt({ uri, headersFor }),
  progress: progressOf(media),
  target: videoTarget({ media, hasPages }),
})

type SortedLineProps = { media: MediaItem; order: Order }

const sortedLine = ({ media, order }: SortedLineProps): string | null =>
  order === null ? null : sortFact({ media, ...order })

/** A video's card as its library lists it: the video, and the order its grid is in, if any. */
type MediaCardProps = Pictures & { media: MediaItem; order?: Order }

/**
 * A movie as its poster, else its frame grab, as the web's poster card draws it, under its
 * year or the value its grid is sorted by.
 */
type MovieCardProps = MediaCardProps

const movieCard = ({ media, api, headersFor, order = null }: MovieCardProps): ShelfCard => {
  const { title, year } = cardTitle(media)
  return videoCard({
    media,
    title,
    line: sortedLine({ media, order }) ?? (year === null ? null : String(year)),
    shape: CARD_SHAPES.poster,
    uri:
      imageOf({ api, item: media.item, kind: ITEM_IMAGE_KINDS.poster }) ?? api.thumbnailUrl(media),
    hasPages: true,
    headersFor,
  })
}

/**
 * Any other video as its frame grab and its length, as the web's media card draws it; it plays
 * at once, as the web's frame cards in a library with no pages do.
 */
type FrameCardProps = MediaCardProps

export const frameCard = ({ media, api, headersFor, order = null }: FrameCardProps): ShelfCard =>
  videoCard({
    media,
    title: mediaLabel(media),
    line: sortedLine({ media, order }) ?? formatRuntime(media.duration),
    shape: CARD_SHAPES.wide,
    uri: api.thumbnailUrl(media),
    hasPages: false,
    headersFor,
  })

const isMovieKind = (kind: LibraryKind): boolean => matchTypeFor(kind) === ITEM_TYPES.movie

/** How a library's videos are drawn: a Movies library's as posters, any other's as frames. */
export const videoShapeFor = (kind: LibraryKind): CardShape =>
  isMovieKind(kind) ? CARD_SHAPES.poster : CARD_SHAPES.wide

type LibraryVideoCardProps = MediaCardProps & { kind: LibraryKind }

/** A video as its library's type draws it: `movieCard` in a Movies library, else `frameCard`. */
export const libraryVideoCard = ({ kind, ...card }: LibraryVideoCardProps): ShelfCard =>
  isMovieKind(kind) ? movieCard(card) : frameCard(card)

type ShowCardProps = Pictures & { entry: ShowEntry; order?: Order }

/** A show as its poster, under the years it ran or the value its grid is sorted by. */
export const showCard = ({ entry, api, headersFor, order = null }: ShowCardProps): ShelfCard => ({
  key: showEntryKey(entry.show),
  title: entry.show.title,
  line:
    (order === null ? null : showSortFact({ entry, ...order })) ??
    showYears({ year: entry.show.year, endedYear: entry.endedYear }),
  shape: CARD_SHAPES.poster,
  picture: pictureAt({
    uri: imageOf({ api, item: entry.show, kind: ITEM_IMAGE_KINDS.poster }),
    headersFor,
  }),
  progress: 0,
  target: itemTarget(entry.show.id),
})
