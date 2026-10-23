import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { FOCUS_CARD_WIDTHS, FocusCard } from '@/layouts/FocusCard'
import {
  NOTHING_HERE,
  SEARCH_EVERY_LIBRARY,
  SEE_ALL,
  type ShelfKit,
  type ShelfProps,
  type ShelvesProps,
  seeAllLabelOf,
} from '@/layouts/shelfKit'
import { PlateButton } from '@/layouts/tvControls'
import { COLOURS, SIZES } from '@/theme/appTheme'

/**
 * Home's shelves under its title and, beside it, the way into the search. That is drawn only
 * once the shelves are read, with them: drawn alone, it would be all tvOS had to give the
 * opening focus to, which belongs to the first card.
 */
const Shelves = ({ title, notice, isLoading, onSearch, children }: ShelvesProps) => (
  <ScrollView contentContainerStyle={styles.shelves} style={styles.ground}>
    <View style={styles.pageRow}>
      <Text accessibilityRole="header" style={styles.pageTitle}>
        {title}
      </Text>
      {!isLoading && (
        <PlateButton
          label={SEARCH_EVERY_LIBRARY.label}
          onPress={onSearch}
          accessibilityRole="link"
          text={SEARCH_EVERY_LIBRARY.text}
        />
      )}
    </View>
    {notice !== null && <Text style={styles.notice}>{notice}</Text>}
    {children}
  </ScrollView>
)

/**
 * A shelf's title, and after a library's the way into the library, which the remote reaches
 * above the row, as the web's shelf heading links to it.
 */
const ShelfTitle = ({ shelf, onOpenLibrary }: Pick<ShelfProps, 'shelf' | 'onOpenLibrary'>) => {
  const { libraryId } = shelf
  return (
    <View style={styles.titleRow}>
      <Text accessibilityRole="header" style={styles.shelfTitle}>
        {shelf.title}
      </Text>
      {libraryId !== null && (
        <Pressable
          accessibilityLabel={seeAllLabelOf(shelf.title)}
          accessibilityRole="link"
          onPress={() => onOpenLibrary(libraryId)}
          style={({ focused }) => [styles.seeAll, focused && styles.focusedLink]}
        >
          {({ focused }) => (
            <Text style={[styles.seeAllLabel, focused === true && styles.focusedLabel]}>
              {SEE_ALL}
            </Text>
          )}
        </Pressable>
      )}
    </View>
  )
}

/** A shelf the remote moves along: its title, then one row, scrolled as focus moves. */
const Shelf = ({ shelf, onOpen, onOpenLibrary, isFirst = false }: ShelfProps) => (
  <View style={styles.shelf}>
    <ShelfTitle shelf={shelf} onOpenLibrary={onOpenLibrary} />
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
            isPreferred={isFirst && index === 0}
            onPress={() => onOpen(card)}
            width={FOCUS_CARD_WIDTHS[card.shape]}
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
  pageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SIZES.space5,
    paddingHorizontal: SIZES.space8,
  },
  pageTitle: { color: COLOURS.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  notice: { color: COLOURS.muted, fontSize: SIZES.textLg, paddingHorizontal: SIZES.space8 },
  shelf: { gap: SIZES.space1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SIZES.space3,
    paddingHorizontal: SIZES.space8,
  },
  shelfTitle: { color: COLOURS.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  seeAll: {
    paddingHorizontal: SIZES.space2,
    paddingVertical: SIZES.space0,
    borderRadius: SIZES.radius,
    borderWidth: SIZES.tvFocusRing,
    borderColor: 'transparent',
  },
  focusedLink: { borderColor: COLOURS.text, backgroundColor: COLOURS.quiet },
  seeAllLabel: { color: COLOURS.muted, fontSize: SIZES.textLg, fontWeight: '600' },
  focusedLabel: { color: COLOURS.text },
  row: { gap: SIZES.space5, paddingHorizontal: SIZES.space8, paddingVertical: SIZES.space4 },
})
