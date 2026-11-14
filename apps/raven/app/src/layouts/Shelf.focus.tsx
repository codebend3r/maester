import { isSameDrawing } from '@/layouts/sameDrawing'
import { useRoute } from 'expo-router'
import {
  Children,
  type ComponentRef,
  type ComponentType,
  memo,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'

import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import type { ShelfCard } from '@/queries/cards'
import type { ShelfView } from '@/queries/homeShelves'

import { FocusBand } from '@/layouts/FocusBand'
import { focusCardWidthOf, FocusCard } from '@/layouts/FocusCard'
import { useOpeningFocus, useScreenFocusScope, useShelfBand } from '@/layouts/focus'
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
  type ShelfPageProps,
} from '@/layouts/shelfKit'
import { BingeCardFocus } from '@/layouts/BingeCard.focus'
import { SHELF_LAYOUTS, type ShelfLayout } from '@/queries/homeShelves'
import { HomePlate } from '@/layouts/HomePlate.focus'
import { Logo } from '@/layouts/Logo'
import { type ShelfViewport, scrollTargetOf } from '@/layouts/shelfScroll'
import { SCROLL_AXES, useScrollWindow } from '@/layouts/useScrollWindow'
import { SideMenu, useSideMenuRoom } from '@/layouts/SideMenu.focus'
import { restoreIn, restoringCardOf, useScreenFocus } from '@/stores/screenFocus'
import { HOME_BANDS, shelfBandOf } from '@/stores/shelfBands'
import { TV_DESIGN_WIDTH } from '@/theme/tvScale'
import { TV_GUTTER, TV_SIZES, tvSize } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

/** Shelves drawn before any scroll, and the shelves a scroll toward the end adds. */
const SHELF_WINDOW = { first: 3, step: 2 } as const

/** Cards drawn in a row before any scroll, and the cards a scroll toward its end adds. */
const CARD_WINDOW = { first: 8, step: 4 } as const

/** The room a shelf brought into view keeps from the view's edge: the shelves' own gap. */
const SHELF_MARGIN = TV_SIZES.space4

/**
 * Brings the shelf of the card taking the focus back into view as Home returns, before the card
 * asks: on tvOS the focus engine refuses a view the shelves clip, and gives the remote to the
 * screen's top left control (the side menu's Search) instead. A Continue watching row added
 * above while Home was covered can push the card the screen was opened from below the view,
 * so the shelves scroll as the engine would have for a card in view, as little as it takes. A
 * layout effect, so it runs before the card's own effect asks in the same commit. Each shelf
 * says where it stands through `useShelfBand`; the view's height and offset are kept here.
 */
const useReturningShelf = () => {
  const screen = useRoute().key
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null)
  const view = useRef<ShelfViewport>({ offset: 0, viewport: 0 })
  const restore = useScreenFocus((state) => restoreIn({ state, screen }))
  useLayoutEffect(() => {
    const shelf = restoringCardOf(restore)?.shelf ?? null
    if (shelf === null) return
    const band = shelfBandOf({ screen, shelf })
    if (band === null) return
    const target = scrollTargetOf({ band, ...view.current, margin: SHELF_MARGIN })
    if (target === null) return
    scroller.current?.scrollTo({ y: target, animated: false })
    view.current = { ...view.current, offset: target }
  }, [restore, screen])
  return {
    scroller,
    onLayout: ({ nativeEvent }: LayoutChangeEvent) => {
      view.current = { ...view.current, viewport: nativeEvent.layout.height }
    },
    onScroll: ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      view.current = { ...view.current, offset: nativeEvent.contentOffset.y }
    },
  }
}

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
  const { scroller, onLayout: measureShelves, onScroll: scrollShelves } = useReturningShelf()
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
        ref={scroller}
        contentContainerStyle={styles.shelves}
        onContentSizeChange={shelfWindow.onContentSizeChange}
        onLayout={(event) => {
          shelfWindow.onLayout(event)
          measureShelves(event)
        }}
        onScroll={(event) => {
          shelfWindow.onScroll(event)
          scrollShelves(event)
        }}
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
            shelf={shelf.key}
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
 * A picture's height over its width in Home's TV sections. Continue watching's tiles stand at
 * about the web's, whose fixed 12.5rem height over half a laptop's page comes to near 3:1, so
 * its three rows fit the screen. A Binge row is 32:9 across the whole width, and the two
 * cards of its second row stand at least that tall.
 */
const TV_FRAMES = { tile: 1 / 3, binge: 9 / 32 } as const

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

/** A column's width, rounded down: tvOS rounds to whole pixels, and two halves a fraction too wide wrapped to one column. */
const columnWidthOf = ({ width, columns }: ColumnWidthOfProps): number =>
  Math.floor((width - TV_SIZES.space5 * (columns - 1)) / columns)

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
              shelf={shelf.key}
              ratio={TV_FRAMES.tile}
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
const ShelfBody = (props: ShelfProps) => {
  const styles = useStyles()
  const band = useShelfBand(props.shelf.key)
  const Row = SHELF_ROWS[shelfStateOf(props.shelf)]
  return (
    /*
     * The key names the shelf to the e2e flows: the side menu also has a row named Continue
     * watching, and the remote on a card below can scroll the title off the screen, so the
     * whole shelf carries it.
     */
    <View onLayout={band.onLayout} style={styles.shelf} testID={props.shelf.key}>
      <ShelfTitle
        onOpenContinue={props.onOpenContinue}
        onOpenLibrary={props.onOpenLibrary}
        shelf={props.shelf}
      />
      <Row {...props} />
    </View>
  )
}

const Shelf = memo(ShelfBody, isSameDrawing<ShelfProps>)

/**
 * The shows the viewer binges, first on Home, right under its title and with no heading of its
 * own, as the web's: one show is a single 32:9 card across the width, two stack, and a third
 * sits beside the second in two columns under the first, every fact inside its card but the
 * synopsis, which only the first row's card has the room for. One band the remote comes into on
 * the first card; nothing is drawn while there are none.
 */
const BingeShelfBody = ({ cards, onOpen, isFirst }: BingeShelfProps) => {
  const { isOpening } = useOpeningFocus()
  const { width, onLayout } = useMeasuredWidth()
  const band = useShelfBand(HOME_BANDS.binge)
  const styles = useStyles()
  return (
    cards.length > 0 && (
      // Measured outside the band: the guide is a view of its own, which the grid's place would be read against.
      <View onLayout={band.onLayout}>
        <FocusBand>
          <View onLayout={onLayout} style={styles.bingeGrid}>
            {width > 0 &&
              bingeRowsOf(cards).flatMap((row, rowIndex) =>
                row.map((card, index) => (
                  <BingeCardFocus
                    key={card.key}
                    card={card}
                    hasSynopsis={rowIndex === 0}
                    height={width * TV_FRAMES.binge}
                    isPreferred={isOpening && isFirst && rowIndex === 0 && index === 0}
                    onPress={() => onOpen(card.target)}
                    place={`${HOME_BANDS.binge}/${card.key}`}
                    shelf={HOME_BANDS.binge}
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

const BingeShelf = memo(BingeShelfBody, isSameDrawing<BingeShelfProps>)

/**
 * A page of shelves on a TV other than Home: the Home plate and the page's name at the top,
 * the shelves below as rows the remote moves along, and a word in Young Serif where there are
 * none. It holds the screen's focus scope, so the first shelf can take the opening focus.
 */
const ShelfPage = ({ title, note, children }: ShelfPageProps) => {
  useScreenFocusScope()
  const styles = useStyles()
  return (
    <ScrollView contentContainerStyle={styles.pageOfShelves} style={styles.ground}>
      <View style={styles.pageHeader}>
        <HomePlate />
        <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.pageTitle}>
          {title}
        </Text>
        {note !== null && (
          <Text variant={TEXT_VARIANTS.display} style={styles.pageNote}>
            {note}
          </Text>
        )}
      </View>
      {children}
    </ScrollView>
  )
}

/**
 * Home on a TV: shelves down the screen, each a row the remote moves along, never the touch
 * layout made larger. The rows run to the screen's edges, past the title-safe margin the
 * titles keep, and leave room above and below for a card grown by focus.
 */
export const focusShelf: ShelfKit = { Shelves, Shelf, BingeShelf, ShelfPage }

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    pageOfShelves: { gap: TV_SIZES.space4, paddingVertical: TV_SIZES.space6 },
    pageHeader: { gap: TV_SIZES.space3, paddingHorizontal: TV_GUTTER },
    pageNote: { color: colours.text, fontSize: TV_SIZES.textLg },
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
    bingeGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TV_SIZES.space5,
      marginHorizontal: TV_GUTTER,
      paddingTop: TV_SIZES.space1,
      // With the shelves' gap, clears the hero's wash, which reaches `space6` above the hero.
      paddingBottom: TV_SIZES.space4,
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
