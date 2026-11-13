import { Image, StyleSheet, View, useWindowDimensions } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { type ItemPage } from '@/queries/itemPage'
import { tvSize } from '@/theme/tvSizes'
import { themedStyles, useTheme } from '@/theme/useTheme'

// An item's backdrop on a TV: the picture across the screen's width, faded into the ground.

/**
 * The backdrop is drawn across the screen's whole width at its own 16:9, its top at the page's,
 * in a box `BACKDROP_HEIGHT` tall that crops its foot, dimmed so the words over it read.
 */
const BACKDROP_RATIO = 9 / 16
const BACKDROP_OPACITY = 0.3
const BACKDROP_HEIGHT = tvSize(700)

/** Where down the backdrop it starts to fade into the page's ground, which it reaches at its foot. */
const BACKDROP_FADE_FROM = 0.45

const BACKDROP_GRADIENT_ID = 'tv-item-backdrop-fade'

type BackdropProps = { backdrop: NonNullable<ItemPage['hero']['backdrop']> }

/**
 * The item's backdrop across the top of the page: the picture from one edge of the screen to the
 * other, its top at the page's, dimmed and fading into the theme's ground toward the foot, so the
 * page below is the theme's own colour.
 */
export const Backdrop = ({ backdrop }: BackdropProps) => {
  const styles = useBackdropStyles()
  const ground = useTheme((theme) => theme.palette.ground)
  const { width } = useWindowDimensions()
  return (
    <View pointerEvents="none" style={[styles.backdropBox, { height: BACKDROP_HEIGHT }]}>
      <Image
        accessibilityElementsHidden
        resizeMode="cover"
        source={backdrop}
        style={[styles.backdrop, { width, height: width * BACKDROP_RATIO }]}
      />
      <Svg height={BACKDROP_HEIGHT} style={StyleSheet.absoluteFill} width={width}>
        <Defs>
          <LinearGradient id={BACKDROP_GRADIENT_ID} x1="0" x2="0" y1="0" y2="1">
            <Stop offset={0} stopColor={ground} stopOpacity={0} />
            <Stop offset={BACKDROP_FADE_FROM} stopColor={ground} stopOpacity={0} />
            <Stop offset={1} stopColor={ground} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect
          fill={`url(#${BACKDROP_GRADIENT_ID})`}
          height={BACKDROP_HEIGHT}
          width={width}
          x={0}
          y={0}
        />
      </Svg>
    </View>
  )
}

const useBackdropStyles = themedStyles(() =>
  StyleSheet.create({
    backdropBox: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
    backdrop: { opacity: BACKDROP_OPACITY },
  }),
)
