import type { LibraryIconName } from '@raven/core'
import type { ReactNode } from 'react'

import type { ShelfCard } from '@/queries/cards'
import type { ShelfView } from '@/queries/homeShelves'

/** A pinned library as the side menu lists it, with the icon it wears there on the web. */
export type MenuLibrary = { id: number; name: string; icon: LibraryIconName }

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
  /** The shelf the screen opens on: its first card takes focus first, on a TV. */
  isFirst?: boolean
}

/** Home's pieces, which each platform lays out and drives its own way. */
export type ShelfKit = {
  Shelves: (props: ShelvesProps) => ReactNode
  Shelf: (props: ShelfProps) => ReactNode
}

export const NOTHING_HERE = 'Nothing here yet.'

/** The way into a library from its shelf, and what it is called aloud: "See all in Films". */
export const SEE_ALL = 'See all'

export const seeAllLabelOf = (title: string): string => `${SEE_ALL} in ${title}`

/** The way into the search through every library, and what it is called aloud. */
export const SEARCH_EVERY_LIBRARY = { text: 'Search', label: 'Search every library' } as const

/** The side menu's heading over the pinned libraries, as the web's. */
export const PINNED_HEADING = 'Pinned'

/** The side menu's foot on a TV: the toggle that folds it to its icons, and back. */
export const MENU_FOOT = {
  collapse: 'Collapse menu',
  expand: 'Expand menu',
} as const

/** The way into Settings: a gear under the thumb, a plate in the TV's top row. */
export const SETTINGS_ENTRY = { label: 'Settings', gear: '\u2699\uFE0E' } as const
