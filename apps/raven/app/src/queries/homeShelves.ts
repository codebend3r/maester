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
  pictureAt,
  showCard,
  videoCard,
} from '@/queries/cards'
import { episodeWordsOf } from '@/queries/episodeMark'
import { type ShowArts, logoOf, showArtOf } from '@/queries/showArt'
import { timeLeftOf } from '@/queries/timeLeft'

/** A shelf of cards; a library's names the library its title opens, Continue watching none. */
export type ShelfView = { key: string; title: string; libraryId: number | null; cards: ShelfCard[] }

export const CONTINUE_WATCHING = 'Continue watching'

const IN_PROGRESS_KEY = 'in-progress'

type ContinueCardProps = Pictures & { entry: PosterEntry; arts: ShowArts }

/**
 * A video in progress, wide, on its show's or film's backdrop with its title art over it:
 * never an episode's own frame grab, which says less than the show's art does, unless the
 * show's backdrop is not read yet or there is none. An episode says its own name and place
 * under the art, a film its year.
 */
export const continueCard = ({ entry, arts, api, headersFor }: ContinueCardProps): ShelfCard => {
  const { media } = entry
  const { item } = media
  const filmBackdrop =
    item === null || item.backdropVersion === null
      ? null
      : pictureAt({ uri: imageOf({ api, item, kind: ITEM_IMAGE_KINDS.backdrop }), headersFor })
  const episode = episodeWordsOf(media)
  const words = tileWords(media)
  const card = videoCard({
    media,
    ...words,
    shape: CARD_SHAPES.wide,
    uri: api.thumbnailUrl(media),
    hasPages: true,
    headersFor,
  })
  return {
    ...card,
    picture: filmBackdrop ?? showArtOf({ entry, arts })?.backdrop ?? card.picture,
    line: episode === null ? words.line : null,
    episode,
    logo: logoOf({ entry, arts }),
    resume: { timeLeft: media.position > 0 ? timeLeftOf(media) : null },
  }
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

type HomeShelvesOfProps = Pictures & {
  home: Home
  libraries: readonly Library[]
  /** The art of the shows and films in progress, as `useShowArts` reads it. */
  arts: ShowArts
}

/**
 * Home's shelves as the web lays them out: what is being watched, then each pinned
 * library's newest (`libraryShelvesOf`). An empty Continue watching is left out.
 */
export const homeShelvesOf = ({
  home,
  libraries,
  arts,
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
            cards: home.inProgress.map((entry) => continueCard({ entry, arts, ...pictures })),
          },
        ]
  return [...continuing, ...libraryShelvesOf({ shelves: home.shelves, libraries, ...pictures })]
}
