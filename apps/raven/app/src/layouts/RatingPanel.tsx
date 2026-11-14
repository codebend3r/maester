import { RATING_SOURCES, type Rating, type RatingSource } from '@raven/core'
import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import { RATING_PANEL_COPY } from '@/layouts/copy'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { RATING_COLOURS, type Palette, type Sizes } from '@/theme/appTheme'
import { translucent } from '@/theme/translucent'
import { useTheme } from '@/theme/useTheme'

/** Every source, in the order the web's panel lists them. */
const SOURCE_ORDER = [
  RATING_SOURCES.rottenTomatoes,
  RATING_SOURCES.imdb,
  RATING_SOURCES.metacritic,
  RATING_SOURCES.tmdb,
] as const satisfies readonly RatingSource[]

/** How much of the raised colour covers the backdrop under the scores, as the web's glass. */
const PANEL_ALPHA = 0.72

const percent = (rating: Rating): string => String(Math.round(rating.value * 10))
const outOfTen = (rating: Rating): string => rating.value.toFixed(1)

const SCORES = {
  [RATING_SOURCES.rottenTomatoes]: percent,
  [RATING_SOURCES.imdb]: outOfTen,
  [RATING_SOURCES.metacritic]: percent,
  [RATING_SOURCES.tmdb]: outOfTen,
} as const satisfies Record<RatingSource, (rating: Rating) => string>

/** How far along its bar a score reaches, out of 1. */
const shareOf = (rating: Rating): number => Math.min(1, Math.max(0, rating.value / 10))

/** The scores a title has, in the panel's order; a source with none is left out. */
const scoredOf = (ratings: readonly Rating[]): Rating[] =>
  SOURCE_ORDER.flatMap((source) => ratings.find((each) => each.source === source) ?? [])

type StylesOfProps = { colours: Palette; sizes: Sizes }

const stylesOf = ({ colours, sizes }: StylesOfProps) =>
  StyleSheet.create({
    panel: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      flexWrap: 'wrap',
      maxWidth: '100%',
      borderWidth: 1,
      borderColor: colours.line,
      borderRadius: sizes.radiusLg,
      overflow: 'hidden',
      backgroundColor: translucent({ colour: colours.raised, alpha: PANEL_ALPHA }),
    },
    item: {
      minWidth: sizes.space8 * 3,
      gap: sizes.space1,
      paddingVertical: sizes.space2,
      paddingHorizontal: sizes.space3,
    },
    divided: { borderLeftWidth: 1, borderLeftColor: colours.line },
    score: { flexDirection: 'row', alignItems: 'baseline', gap: sizes.space0 },
    value: { color: colours.text, fontSize: sizes.textXl },
    scale: { color: colours.muted, fontSize: sizes.textXs },
    track: {
      height: 3,
      overflow: 'hidden',
      borderRadius: sizes.radiusPill,
      backgroundColor: colours.track,
    },
    fill: { height: '100%', borderRadius: sizes.radiusPill },
    label: {
      color: colours.muted,
      fontSize: sizes.textXs,
      fontWeight: '600',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
  })

type RatingCellProps = {
  rating: Rating
  isFirst: boolean
  styles: ReturnType<typeof stylesOf>
}

const RatingCell = ({ rating, isFirst, styles }: RatingCellProps) => {
  const words = RATING_PANEL_COPY.sources[rating.source]
  const score = SCORES[rating.source](rating)
  return (
    <View
      accessible
      accessibilityLabel={RATING_PANEL_COPY.itemLabel({ ...words, score })}
      style={[styles.item, !isFirst && styles.divided]}
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
            { width: `${shareOf(rating) * 100}%`, backgroundColor: RATING_COLOURS[rating.source] },
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
}

/**
 * A title's scores in one framed panel, as the web's item header shows them: each source's
 * score over a bar in its colour, and its name under it. Nothing for a title with no score.
 */
export const RatingPanel = ({ ratings, sizes }: RatingPanelProps) => {
  const colours = useTheme((theme) => theme.palette)
  const styles = useMemo(() => stylesOf({ colours, sizes }), [colours, sizes])
  const scored = scoredOf(ratings)
  return (
    scored.length > 0 && (
      <View accessibilityLabel={RATING_PANEL_COPY.ratings} style={styles.panel}>
        {scored.map((rating, index) => (
          <RatingCell key={rating.source} isFirst={index === 0} rating={rating} styles={styles} />
        ))}
      </View>
    )
  )
}
