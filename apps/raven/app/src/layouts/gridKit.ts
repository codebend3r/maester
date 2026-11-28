import { type JumpScale, LIBRARY_VIEWS, type LibraryIconName, type LibraryView } from '@raven/core'
import type { IconName } from '@raven/ui/iconDrawings'
import type { ReactNode } from 'react'

import type { ShelfCard } from '@/queries/cards'
import type { GridSection } from '@/queries/libraryGrid'

/** One of a library's main pages as a tab beside its name. */
export type GridTab = {
  key: string
  label: string
  icon: IconName
  /** The page open now. */
  isOn: boolean
  onPress: () => void
}

export type GridProps = {
  title: string
  /** The library's icon, the one the side menu's pinned row wears; null while no library is known. */
  icon: LibraryIconName | null
  /** What the library is and holds: "Movies, 1,204 videos". */
  line: string | null
  /** A line in place of the cards: while they load, when they fail, or when there are none. */
  notice: string | null
  /** The library's search box, over the pickers. */
  search: ReactNode
  /** The pickers over the cards. */
  toolbar: ReactNode
  /**
   * The library's main pages as tabs at the right of its name's row, which a screen hands only
   * an iPad's grid; with none, the toolbar reaches them.
   */
  tabs?: readonly GridTab[]
  sections: GridSection[]
  view: LibraryView
  /**
   * Whether a poster keeps its words under it on a TV, where a library's posters are the picture
   * alone: Coming soon's, whose words say what the poster does not, when it comes and where its
   * request stands.
   */
  hasPosterCaptions?: boolean
  /** The strip that jumps through the order, as the web's; null for an order with none. */
  jump: JumpScale | null
  onOpen: (card: ShelfCard) => void
  onBack: () => void
}

/** A library's grid, which each platform lays out and drives its own way. */
export type GridKit = { Grid: (props: GridProps) => ReactNode }

/** The views that lay the cards out as rows of words, one card a row, rather than as cards. */
const ROW_VIEW_LIST = [LIBRARY_VIEWS.list, LIBRARY_VIEWS.tiles] as const

export type RowView = (typeof ROW_VIEW_LIST)[number]

const ROW_VIEWS: ReadonlySet<LibraryView> = new Set(ROW_VIEW_LIST)

export const isRowView = (view: LibraryView): view is RowView => ROW_VIEWS.has(view)

/** How a grid draws each card: as a row of words, as a card, or as a panel, its poster beside its words. */
export const CARD_LAYOUTS = { rows: 'rows', cards: 'cards', panels: 'panels' } as const

export type CardLayout = (typeof CARD_LAYOUTS)[keyof typeof CARD_LAYOUTS]

type CardLayoutOfProps = { view: LibraryView; hasPanels: boolean }

/** How a run of cards is drawn: as panels where its section asks for them, else as its view lays cards out. */
export const cardLayoutOf = ({ view, hasPanels }: CardLayoutOfProps): CardLayout => {
  if (hasPanels) return CARD_LAYOUTS.panels
  return isRowView(view) ? CARD_LAYOUTS.rows : CARD_LAYOUTS.cards
}

/** A section's heading as it is read out: "Matched, 3 videos". */
export const headingLabelOf = (section: GridSection): string =>
  section.count === null ? (section.title ?? '') : `${section.title ?? ''}, ${section.count}`

/** Turns a bucket's chevron to show whether it is open. */
export const CHEVRONS = { open: '▾', shut: '▸' } as const

type PickerOption<K extends string> = { key: K; label: string }

export type PickerProps<K extends string> = {
  /** What is being picked: "Sort". */
  label: string
  /** Drawn beside the text, the web's icon for the same control; decorative. */
  icon: IconName
  options: readonly PickerOption<K>[]
  value: K
  onChoose: (key: K) => void
  /** Hears a TV picker's list open and close, for a screen that must stay up while it is open. */
  onOpenChange?: (isOpen: boolean) => void
  /** Drawn over the video: the chip, and the sheet or list it opens, are dark in every theme. */
  isOverPicture?: boolean
  /**
   * Drawn as its icon alone under the thumb, for a picker whose value is not worth showing
   * (View, Group by); Sort and Speed keep their word and their value. The spoken label is
   * unchanged, and the TV ignores it.
   */
  isIconOnly?: boolean
}

export type ToolButtonProps = {
  /** The words a TV's plate and an iPad's chip show; on a phone the button is its icon alone. */
  label: string
  /** Drawn beside the text, the web's icon for the same control; decorative. */
  icon: IconName
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

type ChosenLabelOfProps<K extends string> = Pick<PickerProps<K>, 'options' | 'value'>

/** What the option chosen now is called: "Title". */
export const chosenLabelOf = <K extends string>({
  options,
  value,
}: ChosenLabelOfProps<K>): string => options.find(({ key }) => key === value)?.label ?? ''

type PickerLabelOfProps<K extends string> = Pick<PickerProps<K>, 'label' | 'options' | 'value'>

/** A picker's button as it is read out: "Sort: Title". */
export const pickerLabelOf = <K extends string>(props: PickerLabelOfProps<K>): string =>
  `${props.label}: ${chosenLabelOf(props)}`
