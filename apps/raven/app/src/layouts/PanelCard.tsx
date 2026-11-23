import { Icon } from '@raven/native'
import { Image, StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { CardPicture, pictureHeightOf } from '@/layouts/Card'
import { PANEL_COPY } from '@/layouts/copy'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { LINE_RATIO, linesHeightOf } from '@/layouts/textHeights'
import { CARD_SHAPES, type ShelfCard } from '@/queries/cards'
import { themedStyles, useTheme } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

/**
 * The poster again behind the panel, blurred into a colour, as the web's `.wash`: its blur, and
 * a strength near the themes' `--glow`. The ground covers it whole up to `solidTo` of the width,
 * then gives way to it, as the web's 110 degree gradient does.
 */
const WASH = { blur: 24, glow: 0.5, solidTo: 0.4 } as const

const WASH_ID = 'panel-wash'

/** How a panel is sized: its poster's width, the room inside it and between its parts, and its words. */
export type PanelScale = {
  poster: number
  padding: number
  gap: number
  radius: number
  posterRadius: number
  title: number
  line: number
}

/** A panel's title runs to two lines, as the web's wide card clamps it. */
const TITLE_LINES = 2

/** The lines under the title: the sorted value, the facts and All watched. */
const WORD_LINES = 3

type PanelHeightOfProps = { scale: PanelScale; fontScale: number }

/** How tall a panel stands: its poster, or its words where they run taller, inside its padding. */
export const panelHeightOf = ({ scale, fontScale }: PanelHeightOfProps): number => {
  const poster = pictureHeightOf({ shape: CARD_SHAPES.poster, width: scale.poster })
  const words = linesHeightOf({
    sizes: [
      ...Array.from({ length: TITLE_LINES }, () => scale.title),
      ...Array.from({ length: WORD_LINES }, () => scale.line),
    ],
    fontScale,
  })
  return Math.max(poster, words) + 2 * scale.padding
}

type PanelWashProps = { picture: NonNullable<ShelfCard['picture']> }

/** The poster blurred behind the panel, under the ground's gradient, as the web's `.wash`. */
const PanelWash = ({ picture }: PanelWashProps) => {
  const raised = useTheme((theme) => theme.palette.raised)
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
    >
      <Image
        blurRadius={WASH.blur}
        resizeMethod="resize"
        resizeMode="cover"
        source={picture}
        style={[StyleSheet.absoluteFill, { opacity: WASH.glow }]}
      />
      <Svg height="100%" style={StyleSheet.absoluteFill} width="100%">
        <Defs>
          <LinearGradient id={WASH_ID} x1="0" x2="1" y1="0" y2="0.36">
            <Stop offset={0} stopColor={raised} stopOpacity={1} />
            <Stop offset={WASH.solidTo} stopColor={raised} stopOpacity={1} />
            <Stop offset={1} stopColor={raised} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect fill={`url(#${WASH_ID})`} height="100%" width="100%" x={0} y={0} />
      </Svg>
    </View>
  )
}

type PanelFaceProps = {
  card: ShelfCard
  scale: PanelScale
  /** The panel's width, which its wash fills. */
  width: number
}

/**
 * A show as the web's wide show card draws it: its poster beside its title, the value the grid is
 * sorted by and its facts, on the panel's ground washed toward the poster's colours from the far
 * side, and once every episode is watched a check saying so at the words' foot. The pressable
 * around it is the layout's: a finger's or the remote's.
 */
export const PanelFace = ({ card, scale, width }: PanelFaceProps) => {
  const styles = useStyles()
  const muted = useTheme((theme) => theme.palette.muted)
  const lineSize = { fontSize: scale.line, lineHeight: scale.line * LINE_RATIO }
  return (
    <View
      style={[
        styles.panel,
        { width, padding: scale.padding, gap: scale.gap, borderRadius: scale.radius },
      ]}
    >
      {card.picture !== null && <PanelWash picture={card.picture} />}
      {/* The check is said in words at the foot, so the poster wears none, as the web's. */}
      <CardPicture
        card={{ ...card, logo: null, isWatched: false }}
        radius={scale.posterRadius}
        width={scale.poster}
      />
      <View style={[styles.words, { gap: scale.gap / 6 }]}>
        <Text
          variant={TEXT_VARIANTS.display}
          numberOfLines={TITLE_LINES}
          style={[styles.title, { fontSize: scale.title, lineHeight: scale.title * LINE_RATIO }]}
        >
          {card.title}
        </Text>
        {card.line !== null && (
          <Text numberOfLines={1} style={[styles.line, lineSize]}>
            {card.line}
          </Text>
        )}
        {!!card.facts && (
          <Text numberOfLines={1} style={[styles.facts, lineSize]}>
            {card.facts}
          </Text>
        )}
        {card.isWatched && (
          <View style={[styles.done, { gap: scale.gap / 3 }]}>
            <Icon colour={muted} name={APP_ICONS.check} size={scale.line} />
            <Text style={[styles.facts, lineSize]}>{PANEL_COPY.allWatched}</Text>
          </View>
        )}
      </View>
    </View>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    panel: { flexDirection: 'row', overflow: 'hidden', backgroundColor: colours.raised },
    words: { flex: 1 },
    title: { color: colours.text },
    line: { color: colours.text },
    facts: { color: colours.muted },
    done: { flexDirection: 'row', alignItems: 'center' },
  }),
)
