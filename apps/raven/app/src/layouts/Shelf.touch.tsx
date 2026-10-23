import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { CARD_SHAPES, type ShelfCard } from '@/queries/homeShelves'
import { CardPicture } from '@/layouts/Card'
import { NOTHING_HERE, type ShelfKit, type ShelfProps, type ShelvesProps } from '@/layouts/shelfKit'
import { COLOURS, SIZES } from '@/theme/appTheme'

/** The web's 48rem: from there on the screen is a tablet's, and the cards grow. */
const TABLET_WIDTH = 48 * 16

/** Card widths in points: about two and a half posters across a phone, more on a tablet. */
const CARD_WIDTHS = {
  phone: { [CARD_SHAPES.poster]: 128, [CARD_SHAPES.wide]: 248 },
  tablet: { [CARD_SHAPES.poster]: 168, [CARD_SHAPES.wide]: 320 },
} as const

const useCardWidths = () => {
  const { width } = useWindowDimensions()
  return width >= TABLET_WIDTH ? CARD_WIDTHS.tablet : CARD_WIDTHS.phone
}

const Shelves = ({ title, notice, children }: ShelvesProps) => {
  const insets = useSafeAreaInsets()
  return (
    <ScrollView
      contentContainerStyle={[
        styles.shelves,
        { paddingTop: insets.top + SIZES.space3, paddingBottom: insets.bottom + SIZES.space5 },
      ]}
      style={styles.ground}
    >
      <Text accessibilityRole="header" style={styles.pageTitle}>
        {title}
      </Text>
      {notice !== null && <Text style={styles.notice}>{notice}</Text>}
      {children}
    </ScrollView>
  )
}

const TouchCard = ({
  card,
  width,
  onPress,
}: {
  card: ShelfCard
  width: number
  onPress: () => void
}) => (
  <Pressable
    accessibilityLabel={card.title}
    accessibilityRole="button"
    onPress={onPress}
    style={({ pressed }) => [styles.card, { width }, pressed && styles.pressed]}
  >
    <CardPicture card={card} width={width} />
    <View>
      <Text numberOfLines={1} style={styles.cardTitle}>
        {card.title}
      </Text>
      {card.line !== null && (
        <Text numberOfLines={1} style={styles.line}>
          {card.line}
        </Text>
      )}
    </View>
  </Pressable>
)

/**
 * A shelf under the thumb: its title, then a row that scrolls sideways and comes to rest on a
 * card's edge, each card as wide as its own shape asks.
 */
const Shelf = ({ shelf, onOpen }: ShelfProps) => {
  const widths = useCardWidths()
  const snaps = shelf.cards.reduce<number[]>(
    (offsets, card) => offsets.concat((offsets.at(-1) ?? 0) + widths[card.shape] + SIZES.space3),
    [0],
  )
  return (
    <View style={styles.shelf}>
      <Text accessibilityRole="header" style={styles.shelfTitle}>
        {shelf.title}
      </Text>
      {shelf.cards.length === 0 ? (
        <Text style={styles.notice}>{NOTHING_HERE}</Text>
      ) : (
        <ScrollView
          contentContainerStyle={styles.row}
          decelerationRate="fast"
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToOffsets={snaps}
        >
          {shelf.cards.map((card) => (
            <TouchCard
              key={card.key}
              card={card}
              onPress={() => onOpen(card)}
              width={widths[card.shape]}
            />
          ))}
        </ScrollView>
      )}
    </View>
  )
}

/** Home on a phone or tablet: the shelves stacked down the page, each scrolled sideways. */
export const touchShelf: ShelfKit = { Shelves, Shelf }

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: COLOURS.ground },
  shelves: { gap: SIZES.space4 },
  pageTitle: {
    color: COLOURS.text,
    fontSize: SIZES.textXl,
    fontWeight: 'bold',
    paddingHorizontal: SIZES.space3,
  },
  notice: { color: COLOURS.muted, fontSize: SIZES.text, paddingHorizontal: SIZES.space3 },
  shelf: { gap: SIZES.space2 },
  shelfTitle: {
    color: COLOURS.text,
    fontSize: SIZES.textLg,
    fontWeight: 'bold',
    paddingHorizontal: SIZES.space3,
  },
  row: { gap: SIZES.space3, paddingHorizontal: SIZES.space3 },
  card: { gap: SIZES.space1 },
  pressed: { opacity: 0.6 },
  cardTitle: { color: COLOURS.text, fontSize: SIZES.textSm, fontWeight: '600' },
  line: { color: COLOURS.muted, fontSize: SIZES.textXs },
})
