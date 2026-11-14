import { CARD_SHAPES, type CardShape } from '@/queries/cards'
import { pictureHeightOf } from '@/layouts/Card'
import { focusCardWidthOf } from '@/layouts/FocusCard'
import { GRID_SIZE_COPY } from '@/layouts/copy'
import { GRID_SIZES, type GridSize } from '@/stores/appPrefs'
import { linesHeightOf } from '@/layouts/textHeights'
import { TV_SIZES, tvSize } from '@/theme/tvSizes'

// How a TV grid sizes its cards and rows: the gaps, the widths each grid size fits, and the captions.

/** How wide the library's icon stands beside its name: the name's own size, larger. */
export const TITLE_ICON = TV_SIZES.textXl * 1.25

export const GAP = TV_SIZES.space5

/** A row of the list and tiles views is at least this wide, so a TV holds three. */
export const LEAST_ROW_WIDTH = tvSize(480)

export const TILE_WIDTHS = {
  [CARD_SHAPES.poster]: tvSize(72),
  [CARD_SHAPES.wide]: tvSize(144),
  [CARD_SHAPES.square]: tvSize(72),
} as const

/** Room above and below each row for a card grown by focus, as Home's rows leave it. */
export const GROWTH_ROOM = TV_SIZES.space4

/** How tall a bucket's heading row stands: the remote's control, or its title at the viewer's size. */
export const headerHeightOf = (fontScale: number): number =>
  Math.max(
    TV_SIZES.controlLarge,
    linesHeightOf({ sizes: [TV_SIZES.textXl], fontScale }) + 2 * TV_SIZES.tvFocusRing,
  ) + TV_SIZES.space3

/** How many rows of cards a grid size fits, and the widest a card may stand as a share of a shelf's. */
type GridSizeFit = { rows: number; widest: number }

/**
 * What each grid size fits: the rows of cards the list's height holds whole at the least, and the
 * widest a card may stand as a share of a shelf's. Small is three rows no wider than a shelf's
 * cards, as the sofa reads them; medium, the default, two rows of larger cards, and large one row
 * of cards larger again, each step half as wide again as the last.
 */
const GRID_SIZE_FITS = {
  [GRID_SIZES.small]: { rows: 3, widest: 1 },
  [GRID_SIZES.medium]: { rows: 2, widest: 1.5 },
  [GRID_SIZES.large]: { rows: 1, widest: 2.25 },
} as const satisfies Record<GridSize, GridSizeFit>

export const GRID_SIZE_OPTIONS = Object.values(GRID_SIZES).map((size) => ({
  key: size,
  label: GRID_SIZE_COPY.sizes[size],
}))

/**
 * Room left for a glimpse of the next row, a share of a row. The grid also widens each card a
 * little to fill its row, which makes the rows taller than planned, and this keeps them in view.
 */
const NEXT_ROW_GLIMPSE = 0.25

/**
 * Whether a grid card of `shape` wears its caption. A poster (a show's or a film's) is the
 * picture alone, its title said aloud, so more fit; an episode's still or an album's cover keeps
 * its words, which the picture does not carry.
 */
export const hasCaptionOf = (shape: CardShape): boolean => shape !== CARD_SHAPES.poster

type CaptionHeightOfProps = { shape: CardShape; captionHeight: number }

/** How tall a grid card's caption stands: none for a poster. */
export const captionHeightOf = ({ shape, captionHeight }: CaptionHeightOfProps): number =>
  hasCaptionOf(shape) ? captionHeight : 0

type CardWidthForRowsProps = {
  shape: CardShape
  listHeight: number
  captionHeight: number
  size: GridSize
}

/**
 * The widest a card of `shape` may stand for the size's rows of it and a glimpse of the next,
 * caption and room to grow included, to fit the list's height; the size's share of a shelf's
 * width where that is narrower already, or before the list is measured.
 */
export const cardWidthForRows = ({
  shape,
  listHeight,
  captionHeight,
  size,
}: CardWidthForRowsProps): number => {
  const fit = GRID_SIZE_FITS[size]
  const shelfWidth = focusCardWidthOf(shape) * fit.widest
  if (listHeight <= 0) return shelfWidth
  const pictureHeight =
    listHeight / (fit.rows + NEXT_ROW_GLIMPSE) -
    captionHeightOf({ shape, captionHeight }) -
    2 * GROWTH_ROOM
  const perWidth = pictureHeightOf({ shape, width: 1 })
  return Math.max(tvSize(1), Math.min(shelfWidth, pictureHeight / perWidth))
}

/** Rows drawn at once: a screen's worth of the smallest posters, with one more coming into view. */
export const GRID_ROWS_AT_ONCE = 4
