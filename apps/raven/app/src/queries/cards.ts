import {
  type ApiClient,
  ITEM_IMAGE_KINDS,
  type ItemSummary,
  type MediaItem,
  type MediaSort,
  type ShowEntry,
  cardTitle,
  formatRuntime,
  mediaEntryKey,
  mediaLabel,
  progressOf,
  showEntryKey,
  showSortFact,
  showYears,
  sortFact,
} from '@raven/core'

/** How a card is drawn: a poster stood upright, or a wide frame. */
export const CARD_SHAPES = { poster: 'poster', wide: 'wide' } as const

export type CardShape = (typeof CARD_SHAPES)[keyof typeof CARD_SHAPES]

/** A picture as React Native's `Image` takes it, with the server's cookies where it needs them. */
type Picture = { uri: string; headers: Record<string, string> }

/** One card, on a shelf or in a grid, as both layouts draw it. */
export type ShelfCard = {
  key: string
  title: string
  line: string | null
  shape: CardShape
  picture: Picture | null
  /** How far in playback stopped, from 0 to 1. */
  progress: number
  /** The item the card opens; null for a file matched to none. */
  itemId: number | null
}

/** Where a card's picture comes from and what goes with the request for it. */
export type Pictures = {
  api: Pick<ApiClient, 'itemImageUrl' | 'thumbnailUrl'>
  headersFor: (uri: string) => Record<string, string>
}

/**
 * The order a grid's cards are listed in, so each says the value it is in order by, and
 * when it is, for the sorts by when files came; null on a shelf, which has no order to explain.
 */
type Order = { sort: MediaSort; now: Date } | null

const pictureAt = ({ uri, headersFor }: Pick<Pictures, 'headersFor'> & { uri: string | null }) =>
  uri === null ? null : { uri, headers: headersFor(uri) }

export const imageOf = ({
  api,
  item,
  kind,
}: Pick<Pictures, 'api'> & {
  item: ItemSummary | null
  kind: typeof ITEM_IMAGE_KINDS.poster | typeof ITEM_IMAGE_KINDS.backdrop
}): string | null => {
  if (item === null) return null
  const version = kind === ITEM_IMAGE_KINDS.poster ? item.posterVersion : item.backdropVersion
  return api.itemImageUrl({ id: item.id, kind, version })
}

/** A card for one video: what it shows is the caller's, the rest comes from the video. */
export const videoCard = ({
  media,
  title,
  line,
  shape,
  uri,
  headersFor,
}: Pick<Pictures, 'headersFor'> & {
  media: MediaItem
  title: string
  line: string | null
  shape: CardShape
  uri: string | null
}): ShelfCard => ({
  key: mediaEntryKey(media),
  title,
  line,
  shape,
  picture: pictureAt({ uri, headersFor }),
  progress: progressOf(media),
  itemId: media.item?.id ?? null,
})

const sortedLine = ({ media, order }: { media: MediaItem; order: Order }): string | null =>
  order === null ? null : sortFact({ media, ...order })

/**
 * A movie as its poster, else its frame grab, as the web's poster card draws it, under its
 * year or the value its grid is sorted by.
 */
export const movieCard = ({
  media,
  api,
  headersFor,
  order = null,
}: Pictures & { media: MediaItem; order?: Order }): ShelfCard => {
  const { title, year } = cardTitle(media)
  return videoCard({
    media,
    title,
    line: sortedLine({ media, order }) ?? (year === null ? null : String(year)),
    shape: CARD_SHAPES.poster,
    uri:
      imageOf({ api, item: media.item, kind: ITEM_IMAGE_KINDS.poster }) ?? api.thumbnailUrl(media),
    headersFor,
  })
}

/** Any other video as its frame grab and its length, as the web's media card draws it. */
export const frameCard = ({
  media,
  api,
  headersFor,
  order = null,
}: Pictures & { media: MediaItem; order?: Order }): ShelfCard =>
  videoCard({
    media,
    title: mediaLabel(media),
    line: sortedLine({ media, order }) ?? formatRuntime(media.duration),
    shape: CARD_SHAPES.wide,
    uri: api.thumbnailUrl(media),
    headersFor,
  })

/** A show as its poster, under the years it ran or the value its grid is sorted by. */
export const showCard = ({
  entry,
  api,
  headersFor,
  order = null,
}: Pictures & { entry: ShowEntry; order?: Order }): ShelfCard => ({
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
  itemId: entry.show.id,
})
