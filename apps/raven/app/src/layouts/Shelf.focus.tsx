import { useState } from 'react'
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { CARD_SHAPES, type ShelfCard } from '@/queries/homeShelves'
import { CardPicture } from '@/layouts/Card'
import { NOTHING_HERE, type ShelfKit, type ShelfProps, type ShelvesProps } from '@/layouts/shelfKit'
import { useReduceMotion } from '@/stores/reduceMotion'
import { COLOURS, SIZES } from '@/theme/appTheme'

/** Card widths in points on a 1920 by 1080 point screen, read from across the room. */
const CARD_WIDTHS = { [CARD_SHAPES.poster]: 232, [CARD_SHAPES.wide]: 400 } as const

/** How much the focused card grows. */
const FOCUS_SCALE = 1.08

const GROW_MS = 150

// The web's `--ease-out`, `cubic-bezier(0.2, 0.8, 0.2, 1)`, which the native tokens cannot carry.
const EASE_OUT = Easing.bezier(0.2, 0.8, 0.2, 1)

const Shelves = ({ title, notice, children }: ShelvesProps) => (
  <ScrollView contentContainerStyle={styles.shelves} style={styles.ground}>
    <Text accessibilityRole="header" style={styles.pageTitle}>
      {title}
    </Text>
    {notice !== null && <Text style={styles.notice}>{notice}</Text>}
    {children}
  </ScrollView>
)

/**
 * A card the remote moves to: it grows and takes the ring while focused, smoothly unless the
 * system asks for less motion, when it changes at once.
 */
const FocusCard = ({
  card,
  isFirst,
  onPress,
}: {
  card: ShelfCard
  isFirst: boolean
  onPress: () => void
}) => {
  const isReduced = useReduceMotion((state) => state.isReduced)
  const [isFocused, setFocused] = useState(false)
  const [scale] = useState(() => new Animated.Value(1))
  const width = CARD_WIDTHS[card.shape]

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
      accessibilityLabel={card.title}
      accessibilityRole="button"
      hasTVPreferredFocus={isFirst}
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
          <Text numberOfLines={1} style={[styles.cardTitle, isFocused && styles.focusedTitle]}>
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

/** A shelf the remote moves along: its title, then one row, scrolled as focus moves. */
const Shelf = ({ shelf, onOpen, isFirst = false }: ShelfProps) => (
  <View style={styles.shelf}>
    <Text accessibilityRole="header" style={styles.shelfTitle}>
      {shelf.title}
    </Text>
    {shelf.cards.length === 0 ? (
      <Text style={styles.notice}>{NOTHING_HERE}</Text>
    ) : (
      <ScrollView
        contentContainerStyle={styles.row}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {shelf.cards.map((card, index) => (
          <FocusCard
            key={card.key}
            card={card}
            isFirst={isFirst && index === 0}
            onPress={() => onOpen(card)}
          />
        ))}
      </ScrollView>
    )}
  </View>
)

/**
 * Home on a TV: shelves down the screen, each a row the remote moves along, never the touch
 * layout made larger. The rows run to the screen's edges, past the title-safe margin the
 * titles keep, and leave room above and below for a card grown by focus.
 */
export const focusShelf: ShelfKit = { Shelves, Shelf }

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: COLOURS.ground },
  shelves: { gap: SIZES.space4, paddingVertical: SIZES.space6 },
  pageTitle: {
    color: COLOURS.text,
    fontSize: SIZES.textXl,
    fontWeight: 'bold',
    paddingHorizontal: SIZES.space8,
  },
  notice: { color: COLOURS.muted, fontSize: SIZES.textLg, paddingHorizontal: SIZES.space8 },
  shelf: { gap: SIZES.space1 },
  shelfTitle: {
    color: COLOURS.text,
    fontSize: SIZES.textXl,
    fontWeight: 'bold',
    paddingHorizontal: SIZES.space8,
  },
  row: { gap: SIZES.space5, paddingHorizontal: SIZES.space8, paddingVertical: SIZES.space4 },
  card: { gap: SIZES.space3 },
  cardTitle: { color: COLOURS.muted, fontSize: SIZES.textLg, fontWeight: '600' },
  focusedTitle: { color: COLOURS.text },
  line: { color: COLOURS.muted, fontSize: SIZES.text },
})
