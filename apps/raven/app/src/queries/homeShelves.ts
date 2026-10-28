import {
  HOME_SHELF_TYPES,
  type Home,
  type HomeShelf,
  ITEM_IMAGE_KINDS,
  type Library,
  type PosterEntry,
  tileWords,
  withLibraries,
} from '@raven/core'

import {
  CARD_SHAPES,
  type Pictures,
  type ShelfCard,
  imageOf,
  libraryVideoCard,
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
type ContinueCardProps = Pictures & { entry: PosterEntry }

const continueCard = ({ entry, api, headersFor }: ContinueCardProps): ShelfCard => {
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

type LibraryCardsProps = Pictures & { shelf: HomeShelf; library: Library }

const libraryCards = ({ shelf, library, ...pictures }: LibraryCardsProps): ShelfCard[] => {
  switch (shelf.type) {
    case HOME_SHELF_TYPES.shows:
      return shelf.shows.map((entry) => showCard({ entry, ...pictures }))
    case HOME_SHELF_TYPES.media:
      return shelf.media.map((media) =>
        libraryVideoCard({ kind: library.settings.kind, media, ...pictures }),
      )
    default: {
      const unknown: never = shelf
      return unknown
    }
  }
}

type LibraryShelvesOfProps = Pictures & {
  shelves: readonly HomeShelf[]
  libraries: readonly Library[]
}

/**
 * A shelf for each library's row, under the library's name, in the server's order: Home's
 * newest arrivals, or what a search found. A row for a library not in the list is left out.
 */
export const libraryShelvesOf = ({
  shelves,
  libraries,
  ...pictures
}: LibraryShelvesOfProps): ShelfView[] =>
  withLibraries({ shelves, libraries }).map(({ shelf, library }) => ({
    key: `library:${library.id}`,
    title: library.name,
    libraryId: library.id,
    cards: libraryCards({ shelf, library, ...pictures }),
  }))

type HomeShelvesOfProps = Pictures & { home: Home; libraries: readonly Library[] }

/**
 * Home's shelves as the web lays them out: what is being watched, then each pinned
 * library's newest (`libraryShelvesOf`). An empty Continue watching is left out.
 */
export const homeShelvesOf = ({
  home,
  libraries,
  ...pictures
}: HomeShelvesOfProps): ShelfView[] => {
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
  return [...continuing, ...libraryShelvesOf({ shelves: home.shelves, libraries, ...pictures })]
}
