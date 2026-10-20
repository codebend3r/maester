import type { ReactNode } from 'react'

import type { ShelfCard } from '@/queries/cards'
import type { ShelfView } from '@/queries/homeShelves'

export type ShelvesProps = {
  title: string
  /** A line in place of the shelves: while they load, when they fail, or when there are none. */
  notice: string | null
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
