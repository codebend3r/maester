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
  type Picture,
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

/** The title art a card in progress wears, by the show's or film's item id. */
export type ArtLogos = ReadonlyMap<number, Picture>

/** The show or film a video in progress belongs to: an episode's show, else the film itself. */
const continueArtOf = (entry: PosterEntry) => entry.poster ?? entry.media.item

/** The shows and films the videos in progress belong to, whose title art their cards wear. */
export const continueArtIdsOf = (entries: readonly PosterEntry[]): number[] =>
  entries.flatMap((entry) => {
    const art = continueArtOf(entry)
    return art === null ? [] : [art.id]
  })

/**
 * A video in progress, wide, on its show's or film's cover art, its backdrop, with its title
 * art over it: never an episode's own frame grab, which says less than the show's art does,
 * unless the show or film has no backdrop at all.
 */
type ContinueCardProps = Pictures & { entry: PosterEntry; logos: ArtLogos }

export const continueCard = ({ entry, logos, api, headersFor }: ContinueCardProps): ShelfCard => {
  const { media } = entry
  const art = continueArtOf(entry)
  const uri =
    imageOf({ api, item: art, kind: ITEM_IMAGE_KINDS.backdrop }) ??
    imageOf({ api, item: media.item, kind: ITEM_IMAGE_KINDS.backdrop }) ??
    api.thumbnailUrl(media)
  return {
    ...videoCard({
      media,
      ...tileWords(media),
      shape: CARD_SHAPES.wide,
      uri,
      hasPages: true,
      headersFor,
    }),
    logo: art === null ? null : (logos.get(art.id) ?? null),
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
  /** The title art of the shows and films in progress, as `useArtLogos` reads it. */
  logos: ArtLogos
}

/**
 * Home's shelves as the web lays them out: what is being watched, then each pinned
 * library's newest (`libraryShelvesOf`). An empty Continue watching is left out.
 */
export const homeShelvesOf = ({
  home,
  libraries,
  logos,
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
            cards: home.inProgress.map((entry) => continueCard({ entry, logos, ...pictures })),
          },
        ]
  return [...continuing, ...libraryShelvesOf({ shelves: home.shelves, libraries, ...pictures })]
}
