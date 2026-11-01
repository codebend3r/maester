import { JUMP_SCALE_LABELS, type JumpScale, LIBRARY_VIEWS, type LibraryView } from '@raven/core'
import { type ComponentRef, type ComponentType, useMemo, useRef, useState } from 'react'
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'

import { Icon } from '@raven/native'
import { Text } from '@/layouts/Text'
import { CARD_SHAPES, type CardShape, type ShelfCard } from '@/queries/cards'
import { CardPicture, pictureHeightOf } from '@/layouts/Card'
import { focusCardWidthOf, FocusCard, focusCaptionHeightOf } from '@/layouts/FocusCard'
import { useOpenerFocus, useOpeningFocus, useScreenFocusScope } from '@/layouts/focus'
import { LINE_RATIO, linesHeightOf } from '@/layouts/textHeights'
import {
  CARD_LAYOUTS,
  CHEVRONS,
  type CardLayout,
  type GridKit,
  type GridProps,
  cardLayoutOf,
  headingLabelOf,
  isRowView,
} from '@/layouts/gridKit'
import {
  GRID_ROWS,
  type GridRow,
  type GridRowKind,
  type GridRowOf,
  gridColumnsOf,
} from '@/layouts/gridRows'
import { type JumpFocus, useJumpFocus } from '@/layouts/useJumpFocus'
import { useGrid } from '@/layouts/useGrid'
import { TV_GUTTER, TV_SIZES, tvSize } from '@/theme/tvSizes'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** How wide the library's icon stands beside its name: the name's own size, larger. */
const TITLE_ICON = TV_SIZES.textXl * 1.25

const GAP = TV_SIZES.space5

/** A row of the list and tiles views is at least this wide, so a TV holds three. */
const LEAST_ROW_WIDTH = tvSize(480)

const TILE_WIDTHS = {
  [CARD_SHAPES.poster]: tvSize(72),
  [CARD_SHAPES.wide]: tvSize(144),
  [CARD_SHAPES.square]: tvSize(72),
} as const

/** Room above and below each row for a card grown by focus, as Home's rows leave it. */
const GROWTH_ROOM = TV_SIZES.space4

/** How tall a bucket's heading row stands: the remote's control, or its title at the viewer's size. */
const headerHeightOf = (fontScale: number): number =>
  Math.max(
    TV_SIZES.controlLarge,
    linesHeightOf({ sizes: [TV_SIZES.textXl], fontScale }) + 2 * TV_SIZES.tvFocusRing,
  ) + TV_SIZES.space3

/** Rows drawn at once: a screen's worth of posters, with one more coming into view. */
const GRID_ROWS_AT_ONCE = 4

/** Screens of rows kept drawn: the one in view and one above and below it. */
const GRID_WINDOW = 3

type RowCardProps = {
  card: ShelfCard
  hasPicture: boolean
  isPreferred: boolean
  jump: JumpFocus | null
  onPress: () => void
}

/**
 * A card of the list or tiles view, the remote's to move to: a row of words, ringed while
 * focused. It takes the focus back when the page it opened goes back, as a `FocusCard` does.
 */
const RowCard = ({ card, hasPicture, isPreferred, jump, onPress }: RowCardProps) => {
  const pressable = useRef<ComponentRef<typeof Pressable>>(null)
  const styles = useStyles()
  useJumpFocus({ jump, view: pressable })
  const { remember } = useOpenerFocus({ place: card.key, view: pressable })
  const { settle } = useOpeningFocus()
  return (
    <Pressable
      ref={pressable}
      accessibilityLabel={card.title}
      accessibilityRole="button"
      hasTVPreferredFocus={isPreferred}
      onFocus={settle}
      onPress={() => {
        remember()
        onPress()
      }}
      style={({ focused }) => [styles.rowCard, focused && styles.focused]}
    >
      {hasPicture && (
        <CardPicture card={card} radius={TV_SIZES.radius} width={TILE_WIDTHS[card.shape]} />
      )}
      <View style={styles.words}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {card.title}
        </Text>
        {card.line !== null && (
          <Text numberOfLines={1} style={styles.rowLine}>
            {card.line}
          </Text>
        )}
      </View>
    </Pressable>
  )
}

type JumpRowProps = {
  jump: JumpScale
  onJump: (keys: ReadonlySet<string>) => void
}

/**
 * The web's jump strip as a row the remote moves along, over the cards: each step takes the
 * focus to the first card under it; a step no card is under cannot be reached.
 */
const JumpRow = ({ jump, onJump }: JumpRowProps) => {
  const styles = useStyles()
  return (
    <ScrollView
      accessibilityLabel={JUMP_SCALE_LABELS[jump.field]}
      contentContainerStyle={styles.jumpRow}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.jumpScroll}
    >
      {jump.unit !== null && <Text style={styles.unit}>{jump.unit}</Text>}
      {jump.marks.map((mark) => {
        const keys = jump.entries.get(mark.key)
        return (
          <Pressable
            key={mark.key}
            accessibilityLabel={mark.name}
            accessibilityRole="button"
            accessibilityState={{ disabled: keys === undefined }}
            disabled={keys === undefined}
            focusable={keys !== undefined}
            onPress={() => keys !== undefined && onJump(keys)}
            style={({ focused }) => [styles.mark, focused && styles.focused]}
          >
            <Text style={[styles.markLabel, keys === undefined && styles.markEmpty]}>
              {mark.label}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

/**
 * The key of what takes the focus as the grid opens: its first row's first card, or its first
 * bucket.
 */
const firstKeyOf = (rows: readonly GridRow[]): string | null => {
  const [first] = rows
  if (first === undefined) return null
  return first.kind === GRID_ROWS.header ? first.key : (first.cards[0]?.key ?? null)
}

/** What a grid's rows draw from beyond the row itself. */
type GridRowContext = {
  view: LibraryView
  preferred: string | null
  heightOf: (row: GridRow) => number
  widthOf: (shape: CardShape) => number
  jumpOf: (card: ShelfCard) => JumpFocus | null
  toggle: ReturnType<typeof useGrid>['toggle']
  settle: () => void
  onOpen: GridProps['onOpen']
}

type GridCellProps = { card: ShelfCard; width: number; grid: GridRowContext }

type RowCellProps = GridCellProps

/** A card of the list or tiles view, in its column. */
const RowCell = ({ card, width, grid }: RowCellProps) => (
  <View style={{ width }}>
    <RowCard
      card={card}
      hasPicture={grid.view === LIBRARY_VIEWS.tiles}
      isPreferred={card.key === grid.preferred}
      jump={grid.jumpOf(card)}
      onPress={() => grid.onOpen(card)}
    />
  </View>
)

type CardCellProps = GridCellProps

const CardCell = ({ card, width, grid }: CardCellProps) => (
  <FocusCard
    card={card}
    isPreferred={card.key === grid.preferred}
    jump={grid.jumpOf(card)}
    onPress={() => grid.onOpen(card)}
    width={width}
  />
)

const GRID_CELLS = {
  [CARD_LAYOUTS.rows]: RowCell,
  [CARD_LAYOUTS.cards]: CardCell,
} as const satisfies Record<CardLayout, ComponentType<GridCellProps>>

type GridRowPartProps<K extends GridRowKind> = { row: GridRowOf<K>; grid: GridRowContext }

type BucketRowProps = GridRowPartProps<typeof GRID_ROWS.header>

/** A bucket's heading, which the remote presses to open or fold it. */
const BucketRow = ({ row, grid }: BucketRowProps) => {
  const styles = useStyles()
  return (
    <View style={[styles.bucketRow, { height: grid.heightOf(row) }]}>
      <Pressable
        accessibilityLabel={headingLabelOf(row.section)}
        accessibilityRole="button"
        accessibilityState={{ expanded: row.isOpen }}
        hasTVPreferredFocus={row.key === grid.preferred}
        onFocus={grid.settle}
        onPress={() => grid.toggle(row.key)}
        style={({ focused }) => [styles.bucket, focused && styles.focused]}
      >
        <Text style={styles.chevron}>{row.isOpen ? CHEVRONS.open : CHEVRONS.shut}</Text>
        <Text numberOfLines={1} style={styles.bucketTitle}>
          {row.section.title}
        </Text>
        <Text style={styles.count}>{row.section.count}</Text>
      </Pressable>
    </View>
  )
}

type CardsRowProps = GridRowPartProps<typeof GRID_ROWS.cards>

/** A run of cards across the grid. */
const CardsRow = ({ row, grid }: CardsRowProps) => {
  const styles = useStyles()
  const Cell = GRID_CELLS[cardLayoutOf(grid.view)]
  return (
    <View
      style={[
        styles.cards,
        isRowView(grid.view) && styles.rowCards,
        { height: grid.heightOf(row) },
      ]}
    >
      {row.cards.map((card) => (
        <Cell key={card.key} card={card} grid={grid} width={grid.widthOf(row.shape)} />
      ))}
    </View>
  )
}

/** Each row kind's view props, or only `Keys`' for a builder generic over the kind. */
type GridRowViewsProps<Keys extends GridRowKind = GridRowKind> = {
  [K in Keys]: GridRowPartProps<K>
}

const GRID_ROW_VIEWS = {
  [GRID_ROWS.header]: BucketRow,
  [GRID_ROWS.cards]: CardsRow,
} as const satisfies ViewsOf<GridRowViewsProps>

type GridRowViewOfProps<K extends GridRowKind> = GridRowPartProps<K> & { kind: K }

/** A row of the grid as its kind's view, so each view is handed its own kind of row. */
const gridRowViewOf = <K extends GridRowKind>({
  kind,
  row,
  grid,
}: GridRowViewOfProps<K>): ViewOf<GridRowViewsProps<K>, K> => ({ key: kind, props: { row, grid } })

/**
 * A library on a TV: its name, what it holds, its search box beside the pickers and the jump
 * row held at the top, and below them the cards in rows the remote moves through, never the
 * touch layout made larger. Focus starts on the first card, and each jump moves it to the card
 * jumped to.
 */
const Grid = ({
  title,
  icon,
  line,
  notice,
  search,
  toolbar,
  sections,
  view,
  jump,
  onOpen,
}: GridProps) => {
  const screen = useWindowDimensions()
  const styles = useStyles()
  const text = useTheme((theme) => theme.palette.text)
  const isRows = isRowView(view)
  const { columnsOf, widthOf } = gridColumnsOf({
    room: screen.width - 2 * TV_GUTTER,
    gap: GAP,
    leastOf: (shape) => (isRows ? LEAST_ROW_WIDTH : focusCardWidthOf(shape)),
  })
  const wordsHeight = linesHeightOf({
    sizes: [TV_SIZES.textLg, TV_SIZES.text],
    fontScale: screen.fontScale,
  })
  const heightOf = (row: GridRow): number => {
    if (row.kind === GRID_ROWS.header) return headerHeightOf(screen.fontScale)
    if (isRows) {
      const picture = pictureHeightOf({ shape: row.shape, width: TILE_WIDTHS[row.shape] })
      return (
        Math.max(view === LIBRARY_VIEWS.tiles ? picture : 0, wordsHeight) +
        TV_SIZES.space3 * 2 +
        TV_SIZES.space2
      )
    }
    return (
      pictureHeightOf({ shape: row.shape, width: widthOf(row.shape) }) +
      focusCaptionHeightOf(screen.fontScale) +
      2 * GROWTH_ROOM
    )
  }
  const { list, rows, toggle, jumpTo, getItemLayout } = useGrid({
    sections,
    columnsOf,
    heightOf,
    top: 0,
  })
  const [listHeight, setListHeight] = useState(0)
  // Each jump counts, the same card twice included. The count last handled is kept apart from
  // rendering, so the card jumped to asks for the focus once for its jump and never again as it
  // mounts afresh: scrolled back to, its bucket reopened, the grid sorted again.
  const [jumped, setJumped] = useState<{ card: string; count: number } | null>(null)
  const handledJump = useRef(0)
  const claimJump = (count: number): boolean => {
    if (count <= handledJump.current) return false
    handledJump.current = count
    return true
  }
  const jumpOf = (card: ShelfCard): JumpFocus | null =>
    jumped !== null && card.key === jumped.card ? { count: jumped.count, claim: claimJump } : null
  // The first card, or bucket, takes the focus as the grid opens, and only then: once anything
  // on the screen has had it, a card drawn later (after a sort, or once a search finds some)
  // must not pull it from the viewer. The header hears its controls' focus as it bubbles up.
  const { isOpening, settle } = useScreenFocusScope()
  const preferred = isOpening ? firstKeyOf(rows) : null
  // What the rows draw from beyond `rows` itself, the one value while neither changes.
  const drawn = useMemo(() => ({ jumped, preferred }), [jumped, preferred])

  type RenderRowProps = { item: GridRow }

  const grid: GridRowContext = {
    view,
    preferred,
    heightOf,
    widthOf,
    jumpOf,
    toggle,
    settle,
    onOpen,
  }

  const renderRow = ({ item: row }: RenderRowProps) => (
    <KeyedView<GridRowViewsProps>
      view={gridRowViewOf({ grid, kind: row.kind, row })}
      views={GRID_ROW_VIEWS}
    />
  )

  return (
    <View style={styles.ground}>
      <View onFocus={settle} style={styles.header}>
        <View style={styles.titleRow}>
          {icon !== null && <Icon colour={text} name={icon} size={TITLE_ICON} />}
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
        </View>
        {line !== null && <Text style={styles.line}>{line}</Text>}
        <View style={styles.toolbar}>
          {search}
          {toolbar}
        </View>
        {jump !== null && (
          <JumpRow
            jump={jump}
            onJump={(keys) => {
              const card = jumpTo(keys)
              if (card === null) return
              settle()
              // From the latest count, so two presses before a render make two jumps.
              setJumped((was) => ({ card, count: (was?.count ?? 0) + 1 }))
            }}
          />
        )}
        {notice !== null && <Text style={styles.notice}>{notice}</Text>}
      </View>
      {/* On a TV the fork wraps the list's ScrollView in a TVFocusGuideView that takes no
          style, so `flex` never reaches it: the list is given the height left below the header. */}
      <View
        onLayout={({ nativeEvent }) => setListHeight(nativeEvent.layout.height)}
        style={styles.listSlot}
      >
        {/* Drawn only once it has its height, so the first card mounts asking for the focus,
            which it then takes; a card that mounted without it would not. */}
        {listHeight > 0 && (
          <FlatList
            ref={list}
            contentContainerStyle={styles.content}
            data={rows}
            extraData={drawn}
            getItemLayout={getItemLayout}
            keyExtractor={(row) => row.key}
            initialNumToRender={GRID_ROWS_AT_ONCE}
            maxToRenderPerBatch={GRID_ROWS_AT_ONCE}
            renderItem={renderRow}
            style={{ height: listHeight }}
            windowSize={GRID_WINDOW}
          />
        )}
      </View>
    </View>
  )
}

/** A library on a TV. */
export const focusGrid: GridKit = { Grid }

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    header: {
      flexShrink: 0,
      gap: TV_SIZES.space2,
      paddingTop: TV_SIZES.space6,
      paddingHorizontal: TV_GUTTER,
      paddingBottom: TV_SIZES.space2,
    },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: TV_SIZES.space3 },
    title: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    line: { color: colours.muted, fontSize: TV_SIZES.textLg },
    toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: TV_SIZES.space3 },
    notice: { color: colours.muted, fontSize: TV_SIZES.textLg },
    // A horizontal ScrollView grows by default, which would leave the cards below no room.
    jumpScroll: { flexGrow: 0 },
    jumpRow: { gap: TV_SIZES.space0, paddingVertical: TV_SIZES.space1, alignItems: 'center' },
    unit: { color: colours.muted, fontSize: TV_SIZES.text, paddingRight: TV_SIZES.space1 },
    mark: {
      minWidth: TV_SIZES.controlLarge,
      minHeight: TV_SIZES.controlLarge,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: 'transparent',
    },
    markLabel: { color: colours.muted, fontSize: TV_SIZES.textLg, fontWeight: '600' },
    markEmpty: { color: colours.line },
    focused: { borderColor: colours.text, backgroundColor: colours.quiet },
    listSlot: { flex: 1 },
    content: { paddingHorizontal: TV_GUTTER, paddingBottom: TV_SIZES.space6 },
    bucketRow: { justifyContent: 'center' },
    bucket: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: TV_SIZES.space2,
      minHeight: TV_SIZES.controlLarge,
      paddingHorizontal: TV_SIZES.space3,
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: 'transparent',
    },
    chevron: { color: colours.muted, fontSize: TV_SIZES.textLg },
    bucketTitle: {
      color: colours.text,
      fontSize: TV_SIZES.textXl,
      lineHeight: TV_SIZES.textXl * LINE_RATIO,
      fontWeight: 'bold',
    },
    count: { color: colours.muted, fontSize: TV_SIZES.textLg },
    cards: { flexDirection: 'row', gap: GAP, paddingVertical: GROWTH_ROOM },
    rowCards: { paddingVertical: TV_SIZES.space1 },
    rowCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space3,
      padding: TV_SIZES.space3,
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: 'transparent',
    },
    words: { flex: 1 },
    rowTitle: {
      color: colours.text,
      fontSize: TV_SIZES.textLg,
      lineHeight: TV_SIZES.textLg * LINE_RATIO,
      fontWeight: '600',
    },
    rowLine: {
      color: colours.muted,
      fontSize: TV_SIZES.text,
      lineHeight: TV_SIZES.text * LINE_RATIO,
    },
  }),
)
