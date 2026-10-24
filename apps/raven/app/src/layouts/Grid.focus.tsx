import { JUMP_SCALE_LABELS, type JumpScale, LIBRARY_VIEWS } from '@raven/core'
import { type ComponentRef, useMemo, useRef, useState } from 'react'
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'

import { CARD_SHAPES, type ShelfCard } from '@/queries/cards'
import { CardPicture, pictureHeightOf } from '@/layouts/Card'
import { focusCardWidthOf, FocusCard, focusCaptionHeightOf } from '@/layouts/FocusCard'
import { useOpenerFocus, useScreenFocusScope } from '@/layouts/focus'
import { LINE_RATIO, linesHeightOf } from '@/layouts/textHeights'
import {
  CHEVRONS,
  type GridKit,
  type GridProps,
  headingLabelOf,
  isRowView,
} from '@/layouts/gridKit'
import { GRID_ROWS, type GridRow, gridColumnsOf } from '@/layouts/gridRows'
import { type JumpFocus, useJumpFocus } from '@/layouts/useJumpFocus'
import { useGrid } from '@/layouts/useGrid'
import { COLOURS } from '@/theme/appTheme'
import { TV_SIZES, tvSize } from '@/theme/tvSizes'

const GUTTER = TV_SIZES.space8
const GAP = TV_SIZES.space5

/** A row of the list and tiles views is at least this wide, so a TV holds three. */
const LEAST_ROW_WIDTH = tvSize(480)

const TILE_WIDTHS = {
  [CARD_SHAPES.poster]: tvSize(72),
  [CARD_SHAPES.wide]: tvSize(144),
} as const

/** Room above and below each row for a card grown by focus, as Home's rows leave it. */
const GROWTH_ROOM = TV_SIZES.space4

/** How tall a bucket's heading row stands: the remote's control, or its title at the viewer's size. */
const headerHeightOf = (fontScale: number): number =>
  Math.max(
    TV_SIZES.controlLarge,
    linesHeightOf({ sizes: [TV_SIZES.textXl], fontScale }) + 2 * TV_SIZES.tvFocusRing,
  ) + TV_SIZES.space3

/**
 * A card of the list or tiles view, the remote's to move to: a row of words, ringed while
 * focused. It takes the focus back when the page it opened goes back, as a `FocusCard` does.
 */
const RowCard = ({
  card,
  hasPicture,
  isPreferred,
  jump,
  onFocused,
  onPress,
}: {
  card: ShelfCard
  hasPicture: boolean
  isPreferred: boolean
  jump: JumpFocus | null
  onFocused: () => void
  onPress: () => void
}) => {
  const pressable = useRef<ComponentRef<typeof Pressable>>(null)
  useJumpFocus({ jump, view: pressable })
  const { remember } = useOpenerFocus({ place: card.key, view: pressable })
  return (
    <Pressable
      ref={pressable}
      accessibilityLabel={card.title}
      accessibilityRole="button"
      hasTVPreferredFocus={isPreferred}
      onFocus={onFocused}
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

/**
 * The web's jump strip as a row the remote moves along, over the cards: each step takes the
 * focus to the first card under it; a step no card is under cannot be reached.
 */
const JumpRow = ({
  jump,
  onJump,
}: {
  jump: JumpScale
  onJump: (keys: ReadonlySet<string>) => void
}) => (
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

/**
 * The key of what takes the focus as the grid opens: its first row's first card, or its first
 * bucket.
 */
const firstKeyOf = (rows: readonly GridRow[]): string | null => {
  const [first] = rows
  if (first === undefined) return null
  return first.kind === GRID_ROWS.header ? first.key : (first.cards[0]?.key ?? null)
}

/**
 * A library on a TV: its name, what it holds, its search box beside the pickers and the jump
 * row held at the top, and below them the cards in rows the remote moves through, never the
 * touch layout made larger. Focus starts on the first card, and each jump moves it to the card
 * jumped to.
 */
const Grid = ({
  title,
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
  const isRows = isRowView(view)
  const { columnsOf, widthOf } = gridColumnsOf({
    room: screen.width - 2 * GUTTER,
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
  const { list, rows, toggle, jumpTo } = useGrid({ sections, columnsOf, heightOf, top: 0 })
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

  const renderRow = ({ item: row }: { item: GridRow }) => {
    switch (row.kind) {
      case GRID_ROWS.header:
        return (
          <View style={[styles.bucketRow, { height: heightOf(row) }]}>
            <Pressable
              accessibilityLabel={headingLabelOf(row.section)}
              accessibilityRole="button"
              accessibilityState={{ expanded: row.isOpen }}
              hasTVPreferredFocus={row.key === preferred}
              onFocus={settle}
              onPress={() => toggle(row.key)}
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
      case GRID_ROWS.cards:
        return (
          <View style={[styles.cards, isRows && styles.rowCards, { height: heightOf(row) }]}>
            {row.cards.map((card) =>
              isRows ? (
                <View key={card.key} style={{ width: widthOf(row.shape) }}>
                  <RowCard
                    card={card}
                    hasPicture={view === LIBRARY_VIEWS.tiles}
                    isPreferred={card.key === preferred}
                    jump={jumpOf(card)}
                    onFocused={settle}
                    onPress={() => onOpen(card)}
                  />
                </View>
              ) : (
                <FocusCard
                  key={card.key}
                  card={card}
                  isPreferred={card.key === preferred}
                  jump={jumpOf(card)}
                  onFocused={settle}
                  onPress={() => onOpen(card)}
                  width={widthOf(row.shape)}
                />
              ),
            )}
          </View>
        )
      default: {
        const unknown: never = row
        return unknown
      }
    }
  }

  return (
    <View style={styles.ground}>
      <View onFocus={settle} style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
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
            keyExtractor={(row) => row.key}
            renderItem={renderRow}
            style={{ height: listHeight }}
          />
        )}
      </View>
    </View>
  )
}

/** A library on a TV. */
export const focusGrid: GridKit = { Grid }

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: COLOURS.ground },
  header: {
    flexShrink: 0,
    gap: TV_SIZES.space2,
    paddingTop: TV_SIZES.space6,
    paddingHorizontal: GUTTER,
    paddingBottom: TV_SIZES.space2,
  },
  title: { color: COLOURS.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
  line: { color: COLOURS.muted, fontSize: TV_SIZES.textLg },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: TV_SIZES.space3 },
  notice: { color: COLOURS.muted, fontSize: TV_SIZES.textLg },
  // A horizontal ScrollView grows by default, which would leave the cards below no room.
  jumpScroll: { flexGrow: 0 },
  jumpRow: { gap: TV_SIZES.space0, paddingVertical: TV_SIZES.space1, alignItems: 'center' },
  unit: { color: COLOURS.muted, fontSize: TV_SIZES.text, paddingRight: TV_SIZES.space1 },
  mark: {
    minWidth: TV_SIZES.controlLarge,
    minHeight: TV_SIZES.controlLarge,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: TV_SIZES.radius,
    borderWidth: TV_SIZES.tvFocusRing,
    borderColor: 'transparent',
  },
  markLabel: { color: COLOURS.muted, fontSize: TV_SIZES.textLg, fontWeight: '600' },
  markEmpty: { color: COLOURS.line },
  focused: { borderColor: COLOURS.text, backgroundColor: COLOURS.quiet },
  listSlot: { flex: 1 },
  content: { paddingHorizontal: GUTTER, paddingBottom: TV_SIZES.space6 },
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
  chevron: { color: COLOURS.muted, fontSize: TV_SIZES.textLg },
  bucketTitle: {
    color: COLOURS.text,
    fontSize: TV_SIZES.textXl,
    lineHeight: TV_SIZES.textXl * LINE_RATIO,
    fontWeight: 'bold',
  },
  count: { color: COLOURS.muted, fontSize: TV_SIZES.textLg },
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
    color: COLOURS.text,
    fontSize: TV_SIZES.textLg,
    lineHeight: TV_SIZES.textLg * LINE_RATIO,
    fontWeight: '600',
  },
  rowLine: {
    color: COLOURS.muted,
    fontSize: TV_SIZES.text,
    lineHeight: TV_SIZES.text * LINE_RATIO,
  },
})
