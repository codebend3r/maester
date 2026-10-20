import {
  HOME_SHELF_TYPES,
  type Home,
  type HomeShelf,
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type Library,
  type PosterEntry,
  matchTypeFor,
  tileWords,
} from '@raven/core'

import {
  CARD_SHAPES,
  type Pictures,
  type ShelfCard,
  frameCard,
  imageOf,
  movieCard,
  showCard,
  videoCard,
} from '@/queries/cards'

/** A shelf of cards; a library's names the library its title opens, Continue watching none. */
export type ShelfView = { key: string; title: string; libraryId: number | null; cards: ShelfCard[] }

export const CONTINUE_WATCHING = 'Continue watching'

const IN_PROGRESS_KEY = 'in-progress'

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
  return videoCard({
    media,
    ...tileWords(media),
    shape: CARD_SHAPES.wide,
    uri,
    hasPages: true,
    headersFor,
  })
}

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
            libraryId: null,
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
        libraryId: library.id,
        cards: libraryCards({ shelf, library, ...pictures }),
      },
    ]
  })
  return [...continuing, ...shelves]
}
