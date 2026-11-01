import { useRouter } from 'expo-router'
import type { ComponentType } from 'react'
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'

import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { CARD_SHAPES } from '@/queries/cards'
import { TouchCard } from '@/layouts/TouchCard'
import { BREAKPOINTS } from '@/layouts/screenSizes'
import {
  NOTHING_HERE,
  SEE_ALL,
  SHELF_STATES,
  type ShelfKit,
  type ShelfProps,
  type ShelfState,
  type ShelvesProps,
  seeAllLabelOf,
  shelfStateOf,
} from '@/layouts/shelfKit'
import { TouchNotice, TouchShelfPage } from '@/layouts/TouchShelfPage'
import { SearchEveryLibrary } from '@/layouts/TouchSearchBar'
import { searchHrefOf } from '@/routes'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

/** Card widths in points: about two and a half posters across a phone, more on a tablet. */
const CARD_WIDTHS = {
  phone: { [CARD_SHAPES.poster]: 128, [CARD_SHAPES.wide]: 288, [CARD_SHAPES.square]: 128 },
  tablet: { [CARD_SHAPES.poster]: 168, [CARD_SHAPES.wide]: 400, [CARD_SHAPES.square]: 168 },
} as const

const useCardWidths = () => {
  const { width } = useWindowDimensions()
  return width >= BREAKPOINTS.tablet ? CARD_WIDTHS.tablet : CARD_WIDTHS.phone
}

const Shelves = ({ title, notice, children }: ShelvesProps) => {
  const router = useRouter()
  return (
    <TouchShelfPage
      isHome
      notice={notice}
      search={<SearchEveryLibrary onSearch={(query) => router.push(searchHrefOf(query))} />}
      title={title}
    >
      {children}
    </TouchShelfPage>
  )
}

type ShelfTitleProps = Pick<ShelfProps, 'shelf' | 'onOpenLibrary'>

/**
 * A shelf's title, and beside a library's the way into the library, as the web's shelf
 * heading links to it.
 */
const ShelfTitle = ({ shelf, onOpenLibrary }: ShelfTitleProps) => {
  const { libraryId } = shelf
  const styles = useStyles()
  return (
    <View style={styles.titleRow}>
      <Text
        variant={TEXT_VARIANTS.display}
        accessibilityRole="header"
        numberOfLines={1}
        style={styles.shelfTitle}
      >
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

/** A shelf with no cards: its line in place of the row. */
const EmptyRow = () => <TouchNotice>{NOTHING_HERE}</TouchNotice>

type CardsRowProps = ShelfProps

/** A shelf's row, which scrolls sideways and comes to rest on a card's edge. */
const CardsRow = ({ shelf, onOpen }: CardsRowProps) => {
  const widths = useCardWidths()
  const styles = useStyles()
  const snaps = shelf.cards.reduce<number[]>(
    (offsets, card) => offsets.concat((offsets.at(-1) ?? 0) + widths[card.shape] + SIZES.space3),
    [0],
  )
  return (
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
  )
}

const SHELF_ROWS = {
  [SHELF_STATES.empty]: EmptyRow,
  [SHELF_STATES.filled]: CardsRow,
} as const satisfies Record<ShelfState, ComponentType<ShelfProps>>

/**
 * A shelf under the thumb: its title, then a row that scrolls sideways and comes to rest on a
 * card's edge, each card as wide as its own shape asks.
 */
const Shelf = (props: ShelfProps) => {
  const styles = useStyles()
  const Row = SHELF_ROWS[shelfStateOf(props.shelf)]
  return (
    <View style={styles.shelf}>
      <ShelfTitle onOpenLibrary={props.onOpenLibrary} shelf={props.shelf} />
      <Row {...props} />
    </View>
  )
}

/** Home on a phone or tablet: the shelves stacked down the page, each scrolled sideways. */
export const touchShelf: ShelfKit = { Shelves, Shelf }

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    shelf: { gap: SIZES.space2 },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: SIZES.space2,
      paddingHorizontal: SIZES.space3,
    },
    shelfTitle: { flexShrink: 1, color: colours.text, fontSize: SIZES.textLg, fontWeight: 'bold' },
    seeAll: { color: colours.muted, fontSize: SIZES.textSm, fontWeight: '600' },
    pressed: { opacity: OPACITIES.pressed },
    // The bottom room keeps a resume card's shadow from being cut off by the row.
    row: { gap: SIZES.space3, paddingHorizontal: SIZES.space3, paddingBottom: SIZES.space2 },
  }),
)
