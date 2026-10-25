import { type JumpScale, LIBRARY_VIEWS, type LibraryView } from '@raven/core'
import type { ReactNode } from 'react'

import type { ShelfCard } from '@/queries/cards'
import type { GridSection } from '@/queries/libraryGrid'

export type GridProps = {
  title: string
  /** What the library is and holds: "Movies, 1,204 videos". */
  line: string | null
  /** A line in place of the cards: while they load, when they fail, or when there are none. */
  notice: string | null
  /** The library's search box, over the pickers. */
  search: ReactNode
  /** The pickers over the cards. */
  toolbar: ReactNode
  sections: GridSection[]
  view: LibraryView
  /** The strip that jumps through the order, as the web's; null for an order with none. */
  jump: JumpScale | null
  onOpen: (card: ShelfCard) => void
  onBack: () => void
}

/** A library's grid, which each platform lays out and drives its own way. */
export type GridKit = { Grid: (props: GridProps) => ReactNode }

/** The views that lay the cards out as rows of words, one card a row, rather than as cards. */
const ROW_VIEWS: ReadonlySet<LibraryView> = new Set([LIBRARY_VIEWS.list, LIBRARY_VIEWS.tiles])

export const isRowView = (view: LibraryView): boolean => ROW_VIEWS.has(view)

/** A section's heading as it is read out: "Matched, 3 videos". */
export const headingLabelOf = (section: GridSection): string =>
  section.count === null ? (section.title ?? '') : `${section.title ?? ''}, ${section.count}`

/** Turns a bucket's chevron to show whether it is open. */
export const CHEVRONS = { open: '▾', shut: '▸' } as const

type PickerOption<K extends string> = { key: K; label: string }

export type PickerProps<K extends string> = {
  /** What is being picked: "Sort". */
  label: string
  options: readonly PickerOption<K>[]
  value: K
  onChoose: (key: K) => void
  /** Hears a TV picker's list open and close, for a screen that must stay up while it is open. */
  onOpenChange?: (isOpen: boolean) => void
  /** Drawn over the video: the chip, and the sheet or list it opens, are dark in every theme. */
  isOverPicture?: boolean
}

export type ToolButtonProps = {
  label: string
  accessibilityLabel: string
  onPress: () => void
  /** Drawn over the video: dark in every theme. */
  isOverPicture?: boolean
}

/** The way back out of a picker without choosing. */
export const CANCEL = 'Cancel'

/** A toolbar's pieces: a picker, the platform's own, and a plain button. */
export type PickerKit = {
  Picker: <K extends string>(props: PickerProps<K>) => ReactNode
  ToolButton: (props: ToolButtonProps) => ReactNode
}

/** What the option chosen now is called: "Title". */
export const chosenLabelOf = <K extends string>({
  options,
  value,
}: Pick<PickerProps<K>, 'options' | 'value'>): string =>
  options.find(({ key }) => key === value)?.label ?? ''

/** A picker's button as it is read out: "Sort: Title". */
export const pickerLabelOf = <K extends string>(props: PickerProps<K>): string =>
  `${props.label}: ${chosenLabelOf(props)}`
