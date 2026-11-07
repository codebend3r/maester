import { useRouter } from 'expo-router'
import { type ComponentType, useState } from 'react'
import {
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native'

import { BingeCardView } from '@/layouts/BingeCard.touch'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { CARD_SHAPES } from '@/queries/cards'
import { TouchCard } from '@/layouts/TouchCard'
import { BREAKPOINTS } from '@/layouts/screenSizes'
import {
  type BingeShelfProps,
  NOTHING_HERE,
  SEE_ALL,
  SHELF_STATES,
  type ShelfKit,
  type ShelfProps,
  type ShelfState,
  type ShelvesProps,
  bingeRowsOf,
  seeAllLabelOf,
  seeAllOf,
  shelfStateOf,
} from '@/layouts/shelfKit'
import { BINGE_COPY } from '@/queries/bingeCards'
import { SHELF_LAYOUTS, type ShelfLayout } from '@/queries/homeShelves'
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

/** Whether the window is wide enough for two columns of wide cards, as on a tablet. */
const useIsWide = (): boolean => useWindowDimensions().width >= BREAKPOINTS.tablet

/** A grid's columns: two where there is room, one stacked column on a phone. */
const columnsOf = (isWide: boolean): number => (isWide ? 2 : 1)

/**
 * The width a section has for its cards: the window's less the page's side margins until it
 * is laid out, then what it measures, which also takes the side insets held sideways out.
 */
const useMeasuredWidth = () => {
  const { width: windowWidth } = useWindowDimensions()
  const [measured, setMeasured] = useState<number | null>(null)
  const onLayout = (event: LayoutChangeEvent) => setMeasured(event.nativeEvent.layout.width)
  return { width: measured ?? windowWidth - SIZES.space3 * 2, onLayout }
}

type ColumnWidthOfProps = { width: number; columns: number }

const columnWidthOf = ({ width, columns }: ColumnWidthOfProps): number =>
  (width - SIZES.space3 * (columns - 1)) / columns

/**
 * A binge card's height for its width: taller than a resume card's 16:9 everywhere, so the
 * synopsis has room, and short and wide where one card spans a tablet.
 */
const BINGE_RATIOS = { full: 0.42, half: 0.7, stacked: 0.78 } as const

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

type ShelfTitleProps = Pick<ShelfProps, 'shelf' | 'onOpenLibrary' | 'onOpenContinue'>

/**
 * A shelf's title, and beside a library's the way into the library, as the web's shelf
 * heading links to it; beside Continue watching, the way to every video in progress once it
 * holds more than Home shows.
 */
const ShelfTitle = ({ shelf, onOpenLibrary, onOpenContinue }: ShelfTitleProps) => {
  const seeAll = seeAllOf({ shelf, onOpenLibrary, onOpenContinue })
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
      {seeAll !== null && (
        <Pressable
          accessibilityLabel={seeAllLabelOf(shelf.title)}
          accessibilityRole="link"
          hitSlop={SIZES.space2}
          onPress={seeAll}
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
      /*
       * Under a search box the keyboard may be up: a card's first tap opens it, not only
       * puts the keyboard away.
       */
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

/**
 * Wide cards in a grid that does not scroll: two columns on a tablet, one stacked column on a
 * phone, each card as wide as its column.
 */
const CardsGrid = ({ shelf, onOpen }: CardsRowProps) => {
  const styles = useStyles()
  const { width, onLayout } = useMeasuredWidth()
  const columnWidth = columnWidthOf({ width, columns: columnsOf(useIsWide()) })
  return (
    <View onLayout={onLayout} style={styles.grid}>
      {width > 0 &&
        shelf.cards.map((card) => (
          <TouchCard key={card.key} card={card} onPress={() => onOpen(card)} width={columnWidth} />
        ))}
    </View>
  )
}

const SHELF_FILLS = {
  [SHELF_LAYOUTS.row]: CardsRow,
  [SHELF_LAYOUTS.grid]: CardsGrid,
} as const satisfies Record<ShelfLayout, ComponentType<ShelfProps>>

const FilledShelf = (props: ShelfProps) => {
  const Fill = SHELF_FILLS[props.shelf.layout]
  return <Fill {...props} />
}

const SHELF_ROWS = {
  [SHELF_STATES.empty]: EmptyRow,
  [SHELF_STATES.filled]: FilledShelf,
} as const satisfies Record<ShelfState, ComponentType<ShelfProps>>

/**
 * A shelf under the thumb: its title, then a row that scrolls sideways and comes to rest on a
 * card's edge, each card as wide as its own shape asks, or Continue watching's grid.
 */
const Shelf = (props: ShelfProps) => {
  const styles = useStyles()
  const Row = SHELF_ROWS[shelfStateOf(props.shelf)]
  return (
    <View style={styles.shelf}>
      <ShelfTitle
        onOpenContinue={props.onOpenContinue}
        onOpenLibrary={props.onOpenLibrary}
        shelf={props.shelf}
      />
      <Row {...props} />
    </View>
  )
}

/**
 * The shows the viewer binges, first on Home: on a tablet the first across the whole width and
 * the rest side by side under it, as the web's; on a phone stacked, each larger than a resume
 * card. Nothing is drawn while there are none.
 */
const BingeShelf = ({ cards, onOpen }: BingeShelfProps) => {
  const styles = useStyles()
  const isWide = useIsWide()
  const { width, onLayout } = useMeasuredWidth()
  const rows = isWide ? bingeRowsOf(cards) : cards.map((card) => [card])
  return (
    cards.length > 0 && (
      <View style={styles.shelf}>
        <View style={styles.titleRow}>
          <Text
            variant={TEXT_VARIANTS.display}
            accessibilityRole="header"
            numberOfLines={1}
            style={styles.shelfTitle}
          >
            {BINGE_COPY.title}
          </Text>
        </View>
        <View onLayout={onLayout} style={styles.grid}>
          {width > 0 &&
            rows.flatMap((row) => {
              const cardWidth = columnWidthOf({ width, columns: row.length })
              const ratio = bingeRatioOf({ isWide, columns: row.length })
              return row.map((card) => (
                <BingeCardView
                  key={card.key}
                  card={card}
                  height={cardWidth * ratio}
                  onOpen={onOpen}
                  width={cardWidth}
                />
              ))
            })}
        </View>
      </View>
    )
  )
}

type BingeRatioOfProps = { isWide: boolean; columns: number }

const bingeRatioOf = ({ isWide, columns }: BingeRatioOfProps): number => {
  if (!isWide) return BINGE_RATIOS.stacked
  return columns === 1 ? BINGE_RATIOS.full : BINGE_RATIOS.half
}

/** Home on a phone or tablet: Binge, then the shelves stacked down the page, each scrolled sideways. */
export const touchShelf: ShelfKit = { Shelves, Shelf, BingeShelf }

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
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: SIZES.space3,
      marginHorizontal: SIZES.space3,
      paddingBottom: SIZES.space2,
    },
  }),
)
