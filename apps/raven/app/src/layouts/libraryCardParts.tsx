import { Image, type StyleProp, StyleSheet, type TextStyle, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import type { LibraryCardLine } from '@/layouts/librariesKit'
import { lineRoleOf } from '@/layouts/lineRole'
import { Text } from '@/layouts/Text'
import type { Picture } from '@/queries/cards'

/** The web card's picture: over the right 55% of the card, at a third of its strength, fading in from its left edge. */
const BACKDROP = { width: '55%', opacity: 0.32, clearFrom: 0.7 } as const

const FADE_ID = 'library-card-fade'

type LibraryBackdropProps = {
  picture: Picture
  /** The card's own colour, which the picture fades in from. */
  ground: string
}

/**
 * A library card's picture, as the web's Libraries page draws it: its newest video over the
 * card's right half, faded in from the card's colour at its left edge so the name stays clear.
 * Decorative, so it takes no touch and says nothing.
 */
export const LibraryBackdrop = ({ picture, ground }: LibraryBackdropProps) => (
  <View
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    pointerEvents="none"
    style={styles.backdrop}
  >
    <Image resizeMode="cover" source={picture} style={styles.picture} />
    <Svg height="100%" style={StyleSheet.absoluteFill} width="100%">
      <Defs>
        <LinearGradient id={FADE_ID} x1="0" x2="1" y1="0" y2="0">
          <Stop offset={0} stopColor={ground} stopOpacity={1} />
          <Stop offset={BACKDROP.clearFrom} stopColor={ground} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect fill={`url(#${FADE_ID})`} height="100%" width="100%" x={0} y={0} />
    </Svg>
  </View>
)

type LibraryCardLinesProps = {
  lines: readonly LibraryCardLine[]
  /** The layout's style for a line, at its own scale. */
  style: StyleProp<TextStyle>
}

/** An open card's lines, a status or why a press failed each, an alert read out at once. */
export const LibraryCardLines = ({ lines, style }: LibraryCardLinesProps) =>
  lines.map((line) => (
    <Text key={line.key} accessibilityRole={lineRoleOf(line.isAlert)} style={style}>
      {line.text}
    </Text>
  ))

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, width: BACKDROP.width },
  picture: { width: '100%', height: '100%', opacity: BACKDROP.opacity },
})
