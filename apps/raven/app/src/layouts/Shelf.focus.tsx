import { Children, type ComponentType, useState } from 'react'
import { type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import type { ShelfCard } from '@/queries/cards'
import type { ShelfView } from '@/queries/homeShelves'

import { FocusBand } from '@/layouts/FocusBand'
import { focusCardWidthOf, FocusCard } from '@/layouts/FocusCard'
import { useOpeningFocus, useScreenFocusScope } from '@/layouts/focus'
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
import { BINGE_COPY, type BingeCard } from '@/queries/bingeCards'
import { SHELF_LAYOUTS, type ShelfLayout } from '@/queries/homeShelves'
import { Logo } from '@/layouts/Logo'
import { SCROLL_AXES, useScrollWindow } from '@/layouts/useScrollWindow'
import { SideMenu, useSideMenuRoom } from '@/layouts/SideMenu.focus'
import { TV_DESIGN_WIDTH } from '@/theme/tvScale'
import { TV_GUTTER, TV_SIZES, tvSize } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

/** Shelves drawn before any scroll, and the shelves a scroll toward the end adds. */
const SHELF_WINDOW = { first: 3, step: 2 } as const

/** Cards drawn in a row before any scroll, and the cards a scroll toward its end adds. */
const CARD_WINDOW = { first: 8, step: 4 } as const

/**
 * Home's shelves under its title, with the side menu beside them. Home draws them only once the
 * shelves are read, so the menu never stands alone as all tvOS has to give the opening focus to,
 * which belongs to the first card. Anything here taking the focus spends the opening focus, so a
 * shelf drawn later never pulls the focus back.
 */
const Shelves = ({
  title,
  notice,
  onSearch,
  onSettings,
  libraries,
  onOpenLibrary,
  children,
}: ShelvesProps) => {
  // Home's hold on its screen's focus; the menu's rows and the shelves' cards spend the opening focus themselves.
  useScreenFocusScope()
  const shelves = Children.toArray(children)
  const shelfWindow = useScrollWindow({
    ...SHELF_WINDOW,
    total: shelves.length,
    axis: SCROLL_AXES.vertical,
  })
  const styles = useStyles()
  const menuRoom = useSideMenuRoom()
  return (
    <View style={[styles.screen, { paddingLeft: menuRoom }]}>
      <SideMenu
        libraries={libraries}
        onOpenLibrary={onOpenLibrary}
        onSearch={onSearch}
        onSettings={onSettings}
      />
      <ScrollView
        contentContainerStyle={styles.shelves}
        onContentSizeChange={shelfWindow.onContentSizeChange}
        onLayout={shelfWindow.onLayout}
        onScroll={shelfWindow.onScroll}
        scrollEventThrottle={100}
        style={styles.ground}
      >
        <View style={styles.pageRow}>
          <Logo width={TV_SIZES.textXl} />
          <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.pageTitle}>
            {title}
          </Text>
        </View>
        {notice !== null && <Text style={styles.notice}>{notice}</Text>}
        {shelves.slice(0, shelfWindow.count)}
      </ScrollView>
    </View>
  )
}

type ShelfTitleProps = Pick<ShelfProps, 'shelf' | 'onOpenLibrary' | 'onOpenContinue'>

/**
 * A shelf's title, and after a library's the way into the library, which the remote reaches
 * above the row, as the web's shelf heading links to it; after Continue watching, the way to
 * every video in progress once it holds more than Home shows.
 */
const ShelfTitle = ({ shelf, onOpenLibrary, onOpenContinue }: ShelfTitleProps) => {
  const seeAll = seeAllOf({ shelf, onOpenLibrary, onOpenContinue })
  const { settle } = useOpeningFocus()
  const styles = useStyles()
  return (
    <View style={styles.titleRow}>
      <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.shelfTitle}>
        {shelf.title}
      </Text>
      {seeAll !== null && (
        <Pressable
          accessibilityLabel={seeAllLabelOf(shelf.title)}
          accessibilityRole="link"
          onFocus={settle}
          onPress={seeAll}
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

type PlaceOfProps = { shelf: ShelfView; card: ShelfCard }

/** Where a card sits on its screen: one title can sit on two shelves, as Continue watching's do. */
const placeOf = ({ shelf, card }: PlaceOfProps): string => `${shelf.key}/${card.key}`

/** A shelf with no cards: its line in place of the row. */
const EmptyRow = () => {
  const styles = useStyles()
  return <Text style={styles.notice}>{NOTHING_HERE}</Text>
}

type CardsRowProps = ShelfProps

/** A shelf's row of cards, a band the remote comes into on a card. */
const CardsRow = ({ shelf, onOpen, isFirst = false }: CardsRowProps) => {
  const { isOpening } = useOpeningFocus()
  const cardWindow = useScrollWindow({
    ...CARD_WINDOW,
    total: shelf.cards.length,
    axis: SCROLL_AXES.horizontal,
  })
  const styles = useStyles()
  return (
    <FocusBand>
      <ScrollView
        contentContainerStyle={styles.row}
        horizontal
        onContentSizeChange={cardWindow.onContentSizeChange}
        onLayout={cardWindow.onLayout}
        onScroll={cardWindow.onScroll}
        scrollEventThrottle={100}
        showsHorizontalScrollIndicator={false}
      >
        {shelf.cards.slice(0, cardWindow.count).map((card, index) => (
          <FocusCard
            key={card.key}
            card={card}
            isPreferred={isOpening && isFirst && index === 0}
            onPress={() => onOpen(card)}
            place={placeOf({ shelf, card })}
            width={focusCardWidthOf(card.shape)}
          />
        ))}
      </ScrollView>
    </FocusBand>
  )
}

/** The columns of Continue watching's grid on a TV, as on the web: three rows of two. */
const GRID_COLUMNS = 2

/**
 * The width a section has for its cards: the window's less the side menu and the gutters
 * until it is laid out, then what it measures.
 */
const useMeasuredWidth = () => {
  const windowWidth = tvSize(TV_DESIGN_WIDTH)
  const menuRoom = useSideMenuRoom()
  const [measured, setMeasured] = useState<number | null>(null)
  const onLayout = (event: LayoutChangeEvent) => setMeasured(event.nativeEvent.layout.width)
  return { width: measured ?? windowWidth - menuRoom - TV_GUTTER * 2, onLayout }
}

type ColumnWidthOfProps = { width: number; columns: number }

const columnWidthOf = ({ width, columns }: ColumnWidthOfProps): number =>
  (width - TV_SIZES.space5 * (columns - 1)) / columns

/**
 * Continue watching's wide cards in two columns that do not scroll sideways, one band the
 * remote comes into on its first card and moves through by where the cards sit.
 */
const CardsGrid = ({ shelf, onOpen, isFirst = false }: CardsRowProps) => {
  const { isOpening } = useOpeningFocus()
  const { width, onLayout } = useMeasuredWidth()
  const styles = useStyles()
  const cardWidth = columnWidthOf({ width, columns: GRID_COLUMNS })
  return (
    <FocusBand>
      <View onLayout={onLayout} style={styles.grid}>
        {width > 0 &&
          shelf.cards.map((card, index) => (
            <FocusCard
              key={card.key}
              card={card}
              isPreferred={isOpening && isFirst && index === 0}
              onPress={() => onOpen(card)}
              place={placeOf({ shelf, card })}
              width={cardWidth}
            />
          ))}
      </View>
    </FocusBand>
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
 * A shelf the remote moves along: its title, then one row, scrolled as focus moves. The row is a
 * band the width of the screen, so the remote coming down or up into it from anywhere lands on
 * a card: the first, or the one it last left there.
 */
const Shelf = (props: ShelfProps) => {
  const styles = useStyles()
  const Row = SHELF_ROWS[shelfStateOf(props.shelf)]
  return (
    // The key names the shelf to the e2e flows: the side menu also has a row named Continue
    // watching, and the remote on a card below can scroll the title off the screen, so the
    // whole shelf carries it.
    <View style={styles.shelf} testID={props.shelf.key}>
      <ShelfTitle
        onOpenContinue={props.onOpenContinue}
        onOpenLibrary={props.onOpenLibrary}
        shelf={props.shelf}
      />
      <Row {...props} />
    </View>
  )
}

const BINGE_KEY = 'binge'

/** A binge card's facts under its picture on a TV, in the web card's order. */
const bingeNotesOf = (card: BingeCard): string[] =>
  [card.meta, card.episodeLine, card.starring, card.synopsis, card.status].filter(
    (note): note is string => note !== null,
  )

/**
 * The shows the viewer binges, first on Home, as the web lays them out: the first across the
 * whole width, the rest side by side under it, each with its episode's synopsis. One band the
 * remote comes into on the first card; nothing is drawn while there are none.
 */
const BingeShelf = ({ cards, onOpen, isFirst }: BingeShelfProps) => {
  const { isOpening } = useOpeningFocus()
  const { width, onLayout } = useMeasuredWidth()
  const styles = useStyles()
  return (
    cards.length > 0 && (
      <View style={styles.shelf}>
        <View style={styles.titleRow}>
          <Text
            variant={TEXT_VARIANTS.display}
            accessibilityRole="header"
            style={styles.shelfTitle}
          >
            {BINGE_COPY.title}
          </Text>
        </View>
        <FocusBand>
          <View onLayout={onLayout} style={styles.grid}>
            {width > 0 &&
              bingeRowsOf(cards).flatMap((row, rowIndex) =>
                row.map((card, index) => (
                  <FocusCard
                    key={card.key}
                    card={card}
                    isPreferred={isOpening && isFirst && rowIndex === 0 && index === 0}
                    notes={bingeNotesOf(card)}
                    onPress={() => onOpen(card.target)}
                    place={`${BINGE_KEY}/${card.key}`}
                    width={columnWidthOf({ width, columns: row.length })}
                  />
                )),
              )}
          </View>
        </FocusBand>
      </View>
    )
  )
}

/**
 * Home on a TV: shelves down the screen, each a row the remote moves along, never the touch
 * layout made larger. The rows run to the screen's edges, past the title-safe margin the
 * titles keep, and leave room above and below for a card grown by focus.
 */
export const focusShelf: ShelfKit = { Shelves, Shelf, BingeShelf }

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    screen: { flex: 1, flexDirection: 'row', backgroundColor: colours.ground },
    ground: { flex: 1, backgroundColor: colours.ground },
    shelves: { gap: TV_SIZES.space4, paddingVertical: TV_SIZES.space6 },
    pageRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space5,
      paddingHorizontal: TV_GUTTER,
    },
    pageTitle: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    notice: { color: colours.muted, fontSize: TV_SIZES.textLg, paddingHorizontal: TV_GUTTER },
    shelf: { gap: TV_SIZES.space1 },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space3,
      paddingHorizontal: TV_GUTTER,
    },
    shelfTitle: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    seeAll: {
      paddingHorizontal: TV_SIZES.space2,
      paddingVertical: TV_SIZES.space0,
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: 'transparent',
    },
    focusedLink: { borderColor: colours.text, backgroundColor: colours.quiet },
    seeAllLabel: { color: colours.muted, fontSize: TV_SIZES.textLg, fontWeight: '600' },
    focusedLabel: { color: colours.text },
    row: {
      gap: TV_SIZES.space5,
      paddingHorizontal: TV_GUTTER,
      paddingVertical: TV_SIZES.space4,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TV_SIZES.space5,
      marginHorizontal: TV_GUTTER,
      paddingVertical: TV_SIZES.space4,
    },
  }),
)
