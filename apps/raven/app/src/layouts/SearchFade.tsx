import { type ComponentRef, useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { useReduceMotion } from '@/stores/reduceMotion'
import { useSearchFocus } from '@/stores/searchFocus'
import { useTheme } from '@/theme/useTheme'

/** How far down the screen the fade reaches, as the web's `25dvh`. */
const FADE_SHARE = 0.25

/** How long it takes to come and go, as the web's 200 ms. */
const FADE_MS = 200

const FADE_ID = 'searchFade'

/** The fade's two ends: the deep ground, solid at the screen's top, clear at its foot. */
const FADE_STOPS = { solid: 1, clear: 0 } as const

/**
 * The web search's focus fade: while a search field holds the focus, the deepest ground fades
 * in from the top of the screen to clear a quarter of the way down, under the header's buttons
 * and the field, so its words stand out over a pale page. It sits at the window's top whatever
 * the header's place, measured as the focus comes, since a drag puts the keyboard away first.
 */
export const SearchFade = () => {
  const isFocused = useSearchFocus((state) => state.isFocused)
  const isReduced = useReduceMotion((state) => state.isReduced)
  const deep = useTheme((theme) => theme.palette.deep)
  const { width, height } = useWindowDimensions()
  const anchor = useRef<ComponentRef<typeof View>>(null)
  const [origin, setOrigin] = useState({ x: 0, y: 0 })
  const [opacity] = useState(() => new Animated.Value(0))
  useEffect(() => {
    if (isFocused) anchor.current?.measureInWindow((x, y) => setOrigin({ x, y }))
    Animated.timing(opacity, {
      toValue: isFocused ? 1 : 0,
      duration: isReduced ? 0 : FADE_MS,
      useNativeDriver: true,
    }).start()
  }, [isFocused, isReduced, opacity])
  const fadeHeight = height * FADE_SHARE
  return (
    <View pointerEvents="none" ref={anchor} style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          styles.fade,
          { left: -origin.x, top: -origin.y, width, height: fadeHeight, opacity },
        ]}
      >
        <Svg height={fadeHeight} width={width}>
          <Defs>
            <LinearGradient id={FADE_ID} x1="0" x2="0" y1="0" y2="1">
              <Stop offset={0} stopColor={deep} stopOpacity={FADE_STOPS.solid} />
              <Stop offset={1} stopColor={deep} stopOpacity={FADE_STOPS.clear} />
            </LinearGradient>
          </Defs>
          <Rect fill={`url(#${FADE_ID})`} height={fadeHeight} width={width} />
        </Svg>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({ fade: { position: 'absolute' } })
