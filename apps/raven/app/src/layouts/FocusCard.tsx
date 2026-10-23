import { type ComponentRef, useRef, useState } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'

import { CARD_SHAPES, type ShelfCard } from '@/queries/cards'
import { CardPicture } from '@/layouts/Card'
import { LINE_RATIO, linesHeightOf } from '@/layouts/textHeights'
import { NOTHING_ON_FOCUS } from '@/layouts/tvControls'
import { type JumpFocus, useJumpFocus } from '@/layouts/useJumpFocus'
import { useReduceMotion } from '@/stores/reduceMotion'
import { COLOURS, SIZES } from '@/theme/appTheme'

/** A card's width in points on a 1920 by 1080 point screen, read from across the room. */
export const FOCUS_CARD_WIDTHS = { [CARD_SHAPES.poster]: 232, [CARD_SHAPES.wide]: 400 } as const

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
 * `isPreferred` asks the remote's focus for it as the screen opens; `jump` takes the focus
 * once per jump that lands on it. `onFocused` hears each time it gets the focus.
 */
export const FocusCard = ({
  card,
  width,
  isPreferred,
  jump = null,
  onFocused = NOTHING_ON_FOCUS,
  onPress,
}: {
  card: ShelfCard
  width: number
  isPreferred: boolean
  jump?: JumpFocus | null
  onFocused?: () => void
  onPress: () => void
}) => {
  const pressable = useRef<ComponentRef<typeof Pressable>>(null)
  useJumpFocus({ jump, view: pressable })
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
        onFocused()
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
