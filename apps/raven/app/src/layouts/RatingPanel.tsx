import { type Rating, inSourceOrder, scoreBarPercent, scoreFigure } from '@raven/core'
import { useMemo } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'

import { RATING_PANEL_COPY } from '@/layouts/copy'
import type { ShelfCard } from '@/queries/cards'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { LINE_RATIO, linesHeightOf } from '@/layouts/textHeights'
import { RATING_COLOURS, type Palette, type Sizes } from '@/theme/appTheme'
import { translucent } from '@/theme/translucent'
import { useTheme } from '@/theme/useTheme'

/** How much of the raised colour covers the backdrop under the scores, as the web's glass. */
const PANEL_ALPHA = 0.72

/** How thick a score's bar and the lines around the cells stand. */
const TRACK_HEIGHT = 3
const BORDER_WIDTH = 1

/** The panel at an item page's size, or cut down to a row's, as a saga's movies show theirs. */
export const RATING_PANEL_SIZES = { full: 'full', mini: 'mini' } as const

type RatingPanelSize = (typeof RATING_PANEL_SIZES)[keyof typeof RATING_PANEL_SIZES]

/**
 * How a panel lays its cells out: in one run that wraps (a TV's or a tablet's), two to a line
 * across a phone narrower than the web's 30rem, as the web's panel does there, or on one line
 * at a row's size.
 */
const PANEL_LOOKS = { run: 'run', twoUp: 'twoUp', mini: 'mini' } as const

type PanelLook = (typeof PANEL_LOOKS)[keyof typeof PANEL_LOOKS]

/** The web's 30rem, under which its panel lays its cells out two to a line. */
const TWO_UP_BELOW = 30 * 16

type PanelLookOfProps = { size: RatingPanelSize; width: number }

const panelLookOf = ({ size, width }: PanelLookOfProps): PanelLook => {
  if (size === RATING_PANEL_SIZES.mini) return PANEL_LOOKS.mini
  if (width < TWO_UP_BELOW) return PANEL_LOOKS.twoUp
  return PANEL_LOOKS.run
}

/** The lengths a panel of one look is drawn with, from the scale it is drawn at. */
type PanelMetrics = {
  value: number
  label: number
  gap: number
  paddingVertical: number
  paddingHorizontal: number
  radius: number
  /** Whether the panel spans its column, as a two-up grid does, or hugs its cells. */
  alignSelf: 'stretch' | 'flex-start'
  /** Whether the cells wrap onto more lines; a row's panel keeps to one so the row's height holds. */
  flexWrap: 'wrap' | 'nowrap'
  /** A cell's width: half the panel two up, else at least the web's cell. */
  cell: { width: `${number}%` } | { minWidth: number }
}

const fullMetrics = (sizes: Sizes) => ({
  value: sizes.textXl,
  label: sizes.textXs,
  gap: sizes.space1,
  paddingVertical: sizes.space2,
  paddingHorizontal: sizes.space3,
  radius: sizes.radiusLg,
  flexWrap: 'wrap' as const,
})

const PANEL_METRICS = {
  // The web's cell is at least 6rem wide.
  [PANEL_LOOKS.run]: (sizes: Sizes) => ({
    ...fullMetrics(sizes),
    alignSelf: 'flex-start' as const,
    cell: { minWidth: sizes.space6 * 2 },
  }),
  [PANEL_LOOKS.twoUp]: (sizes: Sizes) => ({
    ...fullMetrics(sizes),
    alignSelf: 'stretch' as const,
    cell: { width: '50%' as const },
  }),
  // The web's row cell is at least 4.75rem wide.
  [PANEL_LOOKS.mini]: (sizes: Sizes) => ({
    value: sizes.textSm,
    label: sizes.textXs,
    gap: sizes.space0,
    paddingVertical: sizes.space0,
    paddingHorizontal: sizes.space2,
    radius: sizes.radius,
    alignSelf: 'flex-start' as const,
    flexWrap: 'nowrap' as const,
    cell: { minWidth: sizes.space8 - sizes.space0 },
  }),
} as const satisfies Record<PanelLook, (sizes: Sizes) => PanelMetrics>

type DividersOfProps = { index: number }

type Dividers = { isLeft: boolean; isTop: boolean }

/** Which lines a cell draws between it and the cells before it: two up, the second column's and the second line's. */
const DIVIDERS = {
  [PANEL_LOOKS.run]: ({ index }: DividersOfProps) => ({ isLeft: index > 0, isTop: false }),
  [PANEL_LOOKS.twoUp]: ({ index }: DividersOfProps) => ({
    isLeft: index % 2 === 1,
    isTop: index >= 2,
  }),
  [PANEL_LOOKS.mini]: ({ index }: DividersOfProps) => ({ isLeft: index > 0, isTop: false }),
} as const satisfies Record<PanelLook, (props: DividersOfProps) => Dividers>

type MiniPanelHeightOfProps = { sizes: Sizes; fontScale: number }

/** How tall a panel on one line stands at the text size the viewer set, for a row that holds one. */
const miniPanelHeightOf = ({ sizes, fontScale }: MiniPanelHeightOfProps): number => {
  const metrics = PANEL_METRICS[PANEL_LOOKS.mini](sizes)
  return (
    linesHeightOf({ sizes: [metrics.value, metrics.label], fontScale }) +
    TRACK_HEIGHT +
    2 * metrics.gap +
    2 * metrics.paddingVertical +
    2 * BORDER_WIDTH
  )
}

/** The gap a row card keeps above its small panel, which `rowRatingsHeightOf` counts. */
const rowRatingsGapOf = (sizes: Sizes): number => sizes.space1

/** A card's scores; a card that carries none has none. */
const ratingsOf = (card: Pick<ShelfCard, 'ratings'>): readonly Rating[] => card.ratings ?? []

type RowRatingsHeightOfProps = {
  cards: readonly Pick<ShelfCard, 'ratings'>[]
  sizes: Sizes
  fontScale: number
}

/**
 * How much taller a grid's row of cards stands for the small panel under its words, the gap
 * above it included: nothing for a row where no card has a score.
 */
export const rowRatingsHeightOf = ({ cards, sizes, fontScale }: RowRatingsHeightOfProps): number =>
  cards.some((card) => ratingsOf(card).length > 0)
    ? rowRatingsGapOf(sizes) + miniPanelHeightOf({ sizes, fontScale })
    : 0

type StylesOfProps = { colours: Palette; sizes: Sizes; look: PanelLook }

const stylesOf = ({ colours, sizes, look }: StylesOfProps) => {
  const metrics = PANEL_METRICS[look](sizes)
  return StyleSheet.create({
    panel: {
      alignSelf: metrics.alignSelf,
      flexDirection: 'row',
      flexWrap: metrics.flexWrap,
      maxWidth: '100%',
      borderWidth: BORDER_WIDTH,
      borderColor: colours.line,
      borderRadius: metrics.radius,
      overflow: 'hidden',
      backgroundColor: translucent({ colour: colours.raised, alpha: PANEL_ALPHA }),
    },
    item: {
      flexShrink: 1,
      ...metrics.cell,
      gap: metrics.gap,
      paddingVertical: metrics.paddingVertical,
      paddingHorizontal: metrics.paddingHorizontal,
    },
    dividedLeft: { borderLeftWidth: BORDER_WIDTH, borderLeftColor: colours.line },
    dividedTop: { borderTopWidth: BORDER_WIDTH, borderTopColor: colours.line },
    score: { flexDirection: 'row', alignItems: 'baseline', gap: sizes.space0 },
    value: {
      color: colours.text,
      fontSize: metrics.value,
      lineHeight: metrics.value * LINE_RATIO,
    },
    scale: { color: colours.muted, fontSize: metrics.label },
    track: {
      height: TRACK_HEIGHT,
      overflow: 'hidden',
      borderRadius: sizes.radiusPill,
      backgroundColor: colours.track,
    },
    fill: { height: '100%', borderRadius: sizes.radiusPill },
    label: {
      color: colours.muted,
      fontSize: metrics.label,
      lineHeight: metrics.label * LINE_RATIO,
      fontWeight: '600',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
  })
}

type RatingCellProps = {
  rating: Rating
  dividers: Dividers
  styles: ReturnType<typeof stylesOf>
}

const RatingCell = ({ rating, dividers, styles }: RatingCellProps) => {
  const words = RATING_PANEL_COPY.sources[rating.source]
  const score = scoreFigure(rating)
  return (
    <View
      accessible
      accessibilityLabel={RATING_PANEL_COPY.itemLabel({ ...words, score })}
      style={[
        styles.item,
        dividers.isLeft && styles.dividedLeft,
        dividers.isTop && styles.dividedTop,
      ]}
    >
      <View style={styles.score}>
        <Text style={styles.value} variant={TEXT_VARIANTS.display}>
          {score}
        </Text>
        <Text style={styles.scale}>{words.shown}</Text>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${scoreBarPercent(rating)}%`,
              backgroundColor: RATING_COLOURS[rating.source],
            },
          ]}
        />
      </View>
      <Text style={styles.label}>{words.label}</Text>
    </View>
  )
}

type RatingPanelProps = {
  ratings: readonly Rating[]
  /** The scale it is drawn at: the touch layouts' `SIZES`, or a TV's `TV_SIZES`. */
  sizes: Sizes
  size: RatingPanelSize
}

/**
 * A title's scores in one framed panel, as the web's item header shows them: each source's
 * score over a bar in its colour, and its name under it. Nothing for a title with no score.
 * `mini` keeps the same cells at a row's size, on one line; on a phone the full panel lays them
 * out two to a line.
 */
export const RatingPanel = ({ ratings, sizes, size }: RatingPanelProps) => {
  const colours = useTheme((theme) => theme.palette)
  const { width } = useWindowDimensions()
  const look = panelLookOf({ size, width })
  const styles = useMemo(() => stylesOf({ colours, sizes, look }), [colours, sizes, look])
  const scored = inSourceOrder(ratings)
  return (
    scored.length > 0 && (
      <View accessibilityLabel={RATING_PANEL_COPY.ratings} style={styles.panel}>
        {scored.map((rating, index) => (
          <RatingCell
            key={rating.source}
            dividers={DIVIDERS[look]({ index })}
            rating={rating}
            styles={styles}
          />
        ))}
      </View>
    )
  )
}

type RowRatingsProps = { card: Pick<ShelfCard, 'ratings'>; sizes: Sizes }

/** A row card's small panel under its words, `rowRatingsHeightOf`'s gap above it; nothing with no score. */
export const RowRatings = ({ card, sizes }: RowRatingsProps) => {
  const ratings = ratingsOf(card)
  return (
    ratings.length > 0 && (
      <View style={{ paddingTop: rowRatingsGapOf(sizes) }}>
        <RatingPanel ratings={ratings} size={RATING_PANEL_SIZES.mini} sizes={sizes} />
      </View>
    )
  )
}
