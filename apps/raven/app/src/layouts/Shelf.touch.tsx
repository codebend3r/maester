import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { CARD_SHAPES } from '@/queries/cards'
import { TouchCard } from '@/layouts/TouchCard'
import {
  NOTHING_HERE,
  SEARCH_EVERY_LIBRARY,
  SEE_ALL,
  type ShelfKit,
  type ShelfProps,
  type ShelvesProps,
  seeAllLabelOf,
} from '@/layouts/shelfKit'
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

const Shelves = ({ title, notice, onSearch, children }: ShelvesProps) => {
  const insets = useSafeAreaInsets()
  return (
    <ScrollView
      contentContainerStyle={[
        styles.shelves,
        {
          paddingTop: insets.top + SIZES.space3,
          paddingBottom: insets.bottom + SIZES.space5,
          // Clear of the Dynamic Island and the corners of a phone held sideways.
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
      style={styles.ground}
    >
      <View style={styles.pageRow}>
        <Text accessibilityRole="header" style={styles.pageTitle}>
          {title}
        </Text>
        <Pressable
          accessibilityLabel={SEARCH_EVERY_LIBRARY.label}
          accessibilityRole="link"
          hitSlop={SIZES.space2}
          onPress={onSearch}
          style={({ pressed }) => [styles.search, pressed && styles.pressed]}
        >
          <Text style={styles.searchLabel}>{SEARCH_EVERY_LIBRARY.text}</Text>
        </Pressable>
      </View>
      {notice !== null && <Text style={styles.notice}>{notice}</Text>}
      {children}
    </ScrollView>
  )
}

/**
 * A shelf's title, and beside a library's the way into the library, as the web's shelf
 * heading links to it.
 */
const ShelfTitle = ({ shelf, onOpenLibrary }: Pick<ShelfProps, 'shelf' | 'onOpenLibrary'>) => {
  const { libraryId } = shelf
  return (
    <View style={styles.titleRow}>
      <Text accessibilityRole="header" numberOfLines={1} style={styles.shelfTitle}>
        {shelf.title}
      </Text>
      {libraryId !== null && (
        <Pressable
          accessibilityLabel={seeAllLabelOf(shelf.title)}
          accessibilityRole="link"
          hitSlop={SIZES.space2}
          onPress={() => onOpenLibrary(libraryId)}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={styles.seeAll}>{SEE_ALL}</Text>
        </Pressable>
      )}
    </View>
  )
}

/**
 * A shelf under the thumb: its title, then a row that scrolls sideways and comes to rest on a
 * card's edge, each card as wide as its own shape asks.
 */
const Shelf = ({ shelf, onOpen, onOpenLibrary }: ShelfProps) => {
  const widths = useCardWidths()
  const snaps = shelf.cards.reduce<number[]>(
    (offsets, card) => offsets.concat((offsets.at(-1) ?? 0) + widths[card.shape] + SIZES.space3),
    [0],
  )
  return (
    <View style={styles.shelf}>
      <ShelfTitle shelf={shelf} onOpenLibrary={onOpenLibrary} />
      {shelf.cards.length === 0 ? (
        <Text style={styles.notice}>{NOTHING_HERE}</Text>
      ) : (
        <ScrollView
          contentContainerStyle={styles.row}
          decelerationRate="fast"
          horizontal
          // Under a search box the keyboard may be up: a card's first tap opens it, not only
          // puts the keyboard away.
          keyboardShouldPersistTaps="handled"
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
  pageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SIZES.space2,
    paddingHorizontal: SIZES.space3,
  },
  pageTitle: { flexShrink: 1, color: COLOURS.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  search: {
    minHeight: SIZES.fieldHeight,
    justifyContent: 'center',
    paddingHorizontal: SIZES.space3,
    borderRadius: SIZES.radius,
    backgroundColor: COLOURS.quiet,
  },
  searchLabel: { color: COLOURS.text, fontSize: SIZES.text, fontWeight: '600' },
  notice: { color: COLOURS.muted, fontSize: SIZES.text, paddingHorizontal: SIZES.space3 },
  shelf: { gap: SIZES.space2 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: SIZES.space2,
    paddingHorizontal: SIZES.space3,
  },
  shelfTitle: { flexShrink: 1, color: COLOURS.text, fontSize: SIZES.textLg, fontWeight: 'bold' },
  seeAll: { color: COLOURS.muted, fontSize: SIZES.textSm, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  row: { gap: SIZES.space3, paddingHorizontal: SIZES.space3 },
})
