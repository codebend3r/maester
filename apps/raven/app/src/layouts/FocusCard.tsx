import { type ComponentRef, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'

import type { ShelfCard } from '@/queries/cards'
import { CardPicture } from '@/layouts/Card'
import { LINE_RATIO, linesHeightOf } from '@/layouts/textHeights'
import { requestTVFocus } from '@/layouts/tvFocus'
import { useReduceMotion } from '@/stores/reduceMotion'
import { COLOURS, SIZES } from '@/theme/appTheme'

/** How much the focused card grows. */
const FOCUS_SCALE = 1.08

const GROW_MS = 150

// The web's `--ease-out`, `cubic-bezier(0.2, 0.8, 0.2, 1)`, which the native tokens cannot carry.
const EASE_OUT = Easing.bezier(0.2, 0.8, 0.2, 1)

/** How tall a focus card's caption stands, from its picture's foot: its title, then its line. */
export const focusCaptionHeightOf = (fontScale: number): number =>
  SIZES.space3 + linesHeightOf({ sizes: [SIZES.textLg, SIZES.text], fontScale })

/**
 * A card the remote moves to, on a shelf or in a grid: it grows and takes the ring while
 * focused, smoothly unless the system asks for less motion, when it changes at once.
 * `isPreferred` asks the remote's focus for it, as the screen opens; `isJumpedTo` takes the
 * focus once it is on screen, as a card a jump mounts afresh must.
 */
export const FocusCard = ({
  card,
  width,
  isPreferred,
  isJumpedTo = false,
  onPress,
}: {
  card: ShelfCard
  width: number
  isPreferred: boolean
  isJumpedTo?: boolean
  onPress: () => void
}) => {
  const pressable = useRef<ComponentRef<typeof Pressable>>(null)
  useEffect(() => {
    if (isJumpedTo) requestTVFocus(pressable.current)
  }, [isJumpedTo])
  const isReduced = useReduceMotion((state) => state.isReduced)
  const [isFocused, setFocused] = useState(false)
  const [scale] = useState(() => new Animated.Value(1))

  const grow = (toValue: number) => {
    if (isReduced) {
      scale.setValue(toValue)
      return
    }
    Animated.timing(scale, {
      toValue,
      duration: GROW_MS,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start()
  }

  return (
    <Pressable
      ref={pressable}
      accessibilityLabel={card.title}
      accessibilityRole="button"
      hasTVPreferredFocus={isPreferred}
      onBlur={() => {
        setFocused(false)
        grow(1)
      }}
      onFocus={() => {
        setFocused(true)
        grow(FOCUS_SCALE)
      }}
      onPress={onPress}
    >
      <Animated.View style={[styles.card, { width, transform: [{ scale }] }]}>
        <CardPicture card={card} ring={isFocused ? SIZES.tvFocusRing : 0} width={width} />
        <View>
          <Text numberOfLines={1} style={[styles.title, isFocused && styles.focusedTitle]}>
            {card.title}
          </Text>
          {card.line !== null && (
            <Text numberOfLines={1} style={styles.line}>
              {card.line}
            </Text>
          )}
        </View>
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { gap: SIZES.space3 },
  title: {
    color: COLOURS.muted,
    fontSize: SIZES.textLg,
    lineHeight: SIZES.textLg * LINE_RATIO,
    fontWeight: '600',
  },
  focusedTitle: { color: COLOURS.text },
  line: { color: COLOURS.muted, fontSize: SIZES.text, lineHeight: SIZES.text * LINE_RATIO },
})
