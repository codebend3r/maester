import { LIBRARY_VIEWS, type LibraryView } from '@raven/core'

import { type RowView, isRowView } from '@/layouts/gridKit'
import { isTabletLayout } from '@/layouts/tabletKit'
import { CARD_SHAPES, type CardShape, type ShelfCard } from '@/queries/cards'
import { LIBRARY_GRID_COPY } from '@/queries/copy'
import { SIZES } from '@/theme/appTheme'

/** A row of the list and tiles views is at least this wide, so a tablet holds two. */
const LEAST_ROW_WIDTH = 320

/** A tile's picture on a phone, by its card's shape. */
const TILE_WIDTHS = {
  [CARD_SHAPES.poster]: 48,
  [CARD_SHAPES.wide]: 96,
  [CARD_SHAPES.square]: 48,
} as const

/** A tile's picture on an iPad, whose rows have the room for a cover worth looking at. */
const TABLET_TILE_WIDTHS = {
  [CARD_SHAPES.poster]: 128,
  [CARD_SHAPES.wide]: 224,
  [CARD_SHAPES.square]: 128,
} as const

/** A tile on an iPad is at least this wide, so its bigger cover keeps room for its words. */
const LEAST_TABLET_TILE_WIDTH = 440

/** How a card of the list or tiles view is drawn. */
export type RowLook = {
  /** The title's and the line's type sizes. */
  title: number
  line: number
  /** The picture's width by the card's shape; null for the list, which has none. */
  pictures: Record<CardShape, number> | null
  /** The narrowest a row stands, which sets the columns; infinite for one row across the screen. */
  least: number
  /** The room between a row's picture and its words. */
  gap: number
  /** Whether the line also says the card's facts: its release, score, quality and codec. */
  hasFacts: boolean
}

const PHONE_ROW = {
  title: SIZES.text,
  line: SIZES.textXs,
  least: LEAST_ROW_WIDTH,
  gap: SIZES.space2,
  hasFacts: false,
} as const

/** A phone's row views: small rows, two to a tablet-wide screen. */
const PHONE_ROW_LOOKS = {
  [LIBRARY_VIEWS.list]: { ...PHONE_ROW, pictures: null },
  [LIBRARY_VIEWS.tiles]: { ...PHONE_ROW, pictures: TILE_WIDTHS },
} as const satisfies Record<RowView, RowLook>

/**
 * An iPad's row views: the list is one column of much bigger type with each title's facts, and
 * the tiles wear much bigger covers.
 */
const TABLET_ROW_LOOKS = {
  [LIBRARY_VIEWS.list]: {
    title: SIZES.textXl,
    line: SIZES.text,
    pictures: null,
    least: Number.POSITIVE_INFINITY,
    gap: SIZES.space3,
    hasFacts: true,
  },
  [LIBRARY_VIEWS.tiles]: {
    title: SIZES.textLg,
    line: SIZES.textSm,
    pictures: TABLET_TILE_WIDTHS,
    least: LEAST_TABLET_TILE_WIDTH,
    gap: SIZES.space3,
    hasFacts: true,
  },
} as const satisfies Record<RowView, RowLook>

/** The look of a view's cards on this device, where the view draws rows; null for one that draws cards. */
export const rowLookOf = (view: LibraryView): RowLook | null => {
  if (!isRowView(view)) return null
  return (isTabletLayout() ? TABLET_ROW_LOOKS : PHONE_ROW_LOOKS)[view]
}

type RowLineOfProps = { card: ShelfCard; look: RowLook }

/** What a row says under its title: its line, and on an iPad its facts after it, each said once. */
export const rowLineOf = ({ card, look }: RowLineOfProps): string | null => {
  if (!look.hasFacts) return card.line
  const facts = [...(card.line === null ? [] : [card.line]), ...(card.rowFacts ?? [])].filter(
    (fact, at, all) => all.indexOf(fact) === at,
  )
  return facts.length === 0 ? null : facts.join(LIBRARY_GRID_COPY.factsSeparator)
}
