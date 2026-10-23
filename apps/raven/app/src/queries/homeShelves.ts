import {
  type ApiClient,
  HOME_SHELF_TYPES,
  type Home,
  type HomeShelf,
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type ItemSummary,
  type Library,
  type MediaItem,
  type PosterEntry,
  type ShowEntry,
  cardTitle,
  formatRuntime,
  matchTypeFor,
  mediaEntryKey,
  mediaLabel,
  progressOf,
  showEntryKey,
  showYears,
  tileWords,
} from '@raven/core'

/** How a card is drawn: a poster stood upright, or a wide frame. */
export const CARD_SHAPES = { poster: 'poster', wide: 'wide' } as const

type CardShape = (typeof CARD_SHAPES)[keyof typeof CARD_SHAPES]

/** A picture as React Native's `Image` takes it, with the server's cookies where it needs them. */
type Picture = { uri: string; headers: Record<string, string> }

/** One card on a shelf, as both layouts draw it. */
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

export type ShelfView = { key: string; title: string; cards: ShelfCard[] }

export const CONTINUE_WATCHING = 'Continue watching'

const IN_PROGRESS_KEY = 'in-progress'

type Pictures = {
  api: Pick<ApiClient, 'itemImageUrl' | 'thumbnailUrl'>
  headersFor: (uri: string) => Record<string, string>
}

const pictureAt = ({ uri, headersFor }: Pick<Pictures, 'headersFor'> & { uri: string | null }) =>
  uri === null ? null : { uri, headers: headersFor(uri) }

const imageOf = ({
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
const videoCard = ({
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

/**
 * A video in progress, wide: a movie on its backdrop, an episode on its own frame grab, as
 * neither a season nor an episode has a backdrop of its own, else the show's backdrop.
 */
const continueCard = ({ entry, api, headersFor }: Pictures & { entry: PosterEntry }): ShelfCard => {
  const { media, poster } = entry
  const uri =
    imageOf({ api, item: media.item, kind: ITEM_IMAGE_KINDS.backdrop }) ??
    api.thumbnailUrl(media) ??
    imageOf({ api, item: poster, kind: ITEM_IMAGE_KINDS.backdrop })
  return videoCard({ media, ...tileWords(media), shape: CARD_SHAPES.wide, uri, headersFor })
}

/** A movie as its poster, else its frame grab, as the web's poster card draws it. */
const movieCard = ({ media, api, headersFor }: Pictures & { media: MediaItem }): ShelfCard => {
  const { title, year } = cardTitle(media)
  return videoCard({
    media,
    title,
    line: year === null ? null : String(year),
    shape: CARD_SHAPES.poster,
    uri:
      imageOf({ api, item: media.item, kind: ITEM_IMAGE_KINDS.poster }) ?? api.thumbnailUrl(media),
    headersFor,
  })
}

/** Any other video as its frame grab and its length, as the web's media card draws it. */
const frameCard = ({ media, api, headersFor }: Pictures & { media: MediaItem }): ShelfCard =>
  videoCard({
    media,
    title: mediaLabel(media),
    line: formatRuntime(media.duration),
    shape: CARD_SHAPES.wide,
    uri: api.thumbnailUrl(media),
    headersFor,
  })

const showCard = ({ entry, api, headersFor }: Pictures & { entry: ShowEntry }): ShelfCard => ({
  key: showEntryKey(entry.show),
  title: entry.show.title,
  line: showYears({ year: entry.show.year, endedYear: entry.endedYear }),
  shape: CARD_SHAPES.poster,
  picture: pictureAt({
    uri: imageOf({ api, item: entry.show, kind: ITEM_IMAGE_KINDS.poster }),
    headersFor,
  }),
  progress: 0,
  itemId: entry.show.id,
})

const libraryCards = ({
  shelf,
  library,
  ...pictures
}: Pictures & { shelf: HomeShelf; library: Library }): ShelfCard[] => {
  switch (shelf.type) {
    case HOME_SHELF_TYPES.shows:
      return shelf.shows.map((entry) => showCard({ entry, ...pictures }))
    case HOME_SHELF_TYPES.media: {
      const isMovies = matchTypeFor(library.settings.kind) === ITEM_TYPES.movie
      return shelf.media.map((media) =>
        isMovies ? movieCard({ media, ...pictures }) : frameCard({ media, ...pictures }),
      )
    }
    default: {
      const unknown: never = shelf
      return unknown
    }
  }
}

/**
 * Home's shelves as the web lays them out: what is being watched, then each pinned
 * library's newest, under the library's name, in the server's order. A shelf for a library
 * not in the list is left out, as is an empty Continue watching.
 */
export const homeShelvesOf = ({
  home,
  libraries,
  ...pictures
}: Pictures & { home: Home; libraries: Library[] }): ShelfView[] => {
  const continuing: ShelfView[] =
    home.inProgress.length === 0
      ? []
      : [
          {
            key: IN_PROGRESS_KEY,
            title: CONTINUE_WATCHING,
            cards: home.inProgress.map((entry) => continueCard({ entry, ...pictures })),
          },
        ]
  const shelves = home.shelves.flatMap((shelf) => {
    const library = libraries.find(({ id }) => id === shelf.libraryId)
    if (library === undefined) return []
    return [
      {
        key: `library:${library.id}`,
        title: library.name,
        cards: libraryCards({ shelf, library, ...pictures }),
      },
    ]
  })
  return [...continuing, ...shelves]
}
