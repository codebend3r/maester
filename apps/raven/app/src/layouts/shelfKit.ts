import type { LibraryIconName } from '@raven/core'
import type { ReactNode } from 'react'

import { LOCKED_LIBRARY_COPY } from '@/layouts/copy'
import type { BingeCard } from '@/queries/bingeCards'
import type { ShelfCard } from '@/queries/cards'
import type { ShelfView } from '@/queries/homeShelves'
import type { RouteTarget } from '@/routes'

/**
 * A pinned library as the side menu lists it, with the icon it wears there on the web, and
 * whether it is locked behind the PIN, which the web marks with a lock and so does the menu.
 */
export type MenuLibrary = { id: number; name: string; icon: LibraryIconName; isLocked: boolean }

type MenuRowLabelOfProps = { label: string; isLocked: boolean }

/** What a side menu's row is called aloud: a locked library's says so, "Films, locked". */
export const menuRowLabelOf = ({ label, isLocked }: MenuRowLabelOfProps): string =>
  isLocked ? LOCKED_LIBRARY_COPY.lockedRow(label) : label

export type ShelvesProps = {
  title: string
  /** A line in place of the shelves: while they load, when they fail, or when there are none. */
  notice: string | null
  /** Opens the search through every library. */
  onSearch: () => void
  /** Opens Settings. */
  onSettings: () => void
  /** The pinned libraries, in the order the web's side menu lists them. */
  libraries: readonly MenuLibrary[]
  /** Opens a library from the side menu. */
  onOpenLibrary: (libraryId: number) => void
  children: ReactNode
}

export type ShelfProps = {
  shelf: ShelfView
  onOpen: (card: ShelfCard) => void
  /** Opens the library a library shelf's title names. */
  onOpenLibrary: (libraryId: number) => void
  /** Opens every video in progress, from a grid that holds more than it shows. */
  onOpenContinue: () => void
  /** The shelf the screen opens on: its first card takes focus first, on a TV. */
  isFirst?: boolean
}

export type BingeShelfProps = {
  cards: readonly BingeCard[]
  /** Goes where a card or its title art leads: the player, or the show's page. */
  onOpen: (target: RouteTarget) => void
  /** Whether the screen opens on the first card, on a TV. */
  isFirst: boolean
}

/** A page of shelves other than Home: its name, the way back, and a word in Young Serif where there is nothing to shelve. */
export type ShelfPageProps = {
  title: string
  onBack: () => void
  /** Set in Young Serif in place of the shelves while there are none; null while there are some. */
  note: string | null
  children: ReactNode
}

/** Home's pieces, which each platform lays out and drives its own way. */
export type ShelfKit = {
  Shelves: (props: ShelvesProps) => ReactNode
  Shelf: (props: ShelfProps) => ReactNode
  BingeShelf: (props: BingeShelfProps) => ReactNode
  ShelfPage: (props: ShelfPageProps) => ReactNode
}

type SeeAllOfProps = Pick<ShelfProps, 'shelf' | 'onOpenLibrary' | 'onOpenContinue'>

type SeeAll = () => void

/** Where a shelf's title leads: its library, every video in progress, or nowhere. */
export const seeAllOf = ({
  shelf,
  onOpenLibrary,
  onOpenContinue,
}: SeeAllOfProps): SeeAll | null => {
  const { libraryId } = shelf
  if (libraryId !== null) return () => onOpenLibrary(libraryId)
  return shelf.hasMore ? onOpenContinue : null
}

/**
 * The Binge section's rows where it has room, as the web lays it out: the first show across
 * the whole width, the rest side by side under it.
 */
export const bingeRowsOf = (cards: readonly BingeCard[]): (readonly BingeCard[])[] => {
  const [first, ...rest] = cards
  if (first === undefined) return []
  return rest.length === 0 ? [[first]] : [[first], rest]
}

export const NOTHING_HERE = 'Nothing here yet.'

/** Whether a shelf has cards to draw, or only its line saying it has none. */
export const SHELF_STATES = { empty: 'empty', filled: 'filled' } as const

export type ShelfState = (typeof SHELF_STATES)[keyof typeof SHELF_STATES]

export const shelfStateOf = (shelf: ShelfView): ShelfState =>
  shelf.cards.length === 0 ? SHELF_STATES.empty : SHELF_STATES.filled

/** The way into a library from its shelf, and what it is called aloud: "See all in Films". */
export const SEE_ALL = 'See all'

export const seeAllLabelOf = (title: string): string => `${SEE_ALL} in ${title}`

/** The way into the search through every library, and what it is called aloud. */
export const SEARCH_EVERY_LIBRARY = { text: 'Search', label: 'Search every library' } as const

/** The side menu's heading over the pinned libraries, as the web's. */
export const PINNED_HEADING = 'Pinned'

/** The side menu's foot on a TV: the toggle that folds it to its icons, and back. */
export const MENU_FOOT = {
  pin: 'Keep menu open',
  unpin: 'Fold menu away',
} as const

/** The way into Settings, and what it is called aloud. */
export const SETTINGS_ENTRY = { label: 'Settings' } as const
