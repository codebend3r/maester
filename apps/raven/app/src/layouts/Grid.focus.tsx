import { JUMP_SCALE_LABELS, type JumpScale, LIBRARY_VIEWS } from '@raven/core'
import { useState } from 'react'
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'

import { CARD_SHAPES, type CardShape, type ShelfCard } from '@/queries/cards'
import { CardPicture, pictureHeightOf } from '@/layouts/Card'
import { FOCUS_CAPTION_HEIGHT, FocusCard } from '@/layouts/FocusCard'
import {
  CHEVRONS,
  type GridKit,
  type GridProps,
  headingLabelOf,
  isRowView,
} from '@/layouts/gridKit'
import { GRID_ROWS, type GridRow, columnsFor } from '@/layouts/gridRows'
import { useGrid } from '@/layouts/useGrid'
import { COLOURS, SIZES } from '@/theme/appTheme'

const GUTTER = SIZES.space8
const GAP = SIZES.space5

/** The narrowest card a row holds, read from across the room, as Home's shelves draw them. */
const LEAST_WIDTHS = { [CARD_SHAPES.poster]: 232, [CARD_SHAPES.wide]: 400 } as const

/** A row of the list and tiles views is at least this wide, so a TV holds three. */
const LEAST_ROW_WIDTH = 480

const TILE_WIDTHS = { [CARD_SHAPES.poster]: 72, [CARD_SHAPES.wide]: 144 } as const

/** Room above and below each row for a card grown by focus, as Home's rows leave it. */
const GROWTH_ROOM = SIZES.space4

const HEADER_HEIGHT = SIZES.controlLarge + SIZES.space3
const WORDS_HEIGHT = SIZES.textLg * 1.25 + SIZES.text * 1.25

/** A card of the list or tiles view, the remote's to move to: a row of words, ringed while focused. */
const RowCard = ({
  card,
  hasPicture,
  isPreferred,
  onPress,
}: {
  card: ShelfCard
  hasPicture: boolean
  isPreferred: boolean
  onPress: () => void
}) => (
  <Pressable
    accessibilityLabel={card.title}
    accessibilityRole="button"
    hasTVPreferredFocus={isPreferred}
    onPress={onPress}
    style={({ focused }) => [styles.rowCard, focused && styles.focused]}
  >
    {hasPicture && <CardPicture card={card} width={TILE_WIDTHS[card.shape]} />}
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

/** The key of what takes the focus as the grid opens: its first row's first card, or its first bucket. */
const firstKeyOf = (rows: readonly GridRow[]): string | null => {
  const [first] = rows
  if (first === undefined) return null
  return first.kind === GRID_ROWS.header ? first.key : (first.cards[0]?.key ?? null)
}

/**
 * A library on a TV: its name, what it holds, the pickers and the jump row held at the top,
 * and below them the cards in rows the remote moves through, never the touch layout made
 * larger. Focus starts on the first card, and a jump moves it to the card jumped to.
 */
const Grid = ({ title, line, notice, toolbar, sections, view, jump, onOpen }: GridProps) => {
  const screen = useWindowDimensions()
  const room = screen.width - 2 * GUTTER
  const isRows = isRowView(view)
  const columnsOf = (shape: CardShape) =>
    columnsFor({ width: room, least: isRows ? LEAST_ROW_WIDTH : LEAST_WIDTHS[shape], gap: GAP })
  const widthOf = (shape: CardShape) => {
    const columns = columnsOf(shape)
    return (room - (columns - 1) * GAP) / columns
  }
  const heightOf = (row: GridRow): number => {
    if (row.kind === GRID_ROWS.header) return HEADER_HEIGHT
    if (isRows) {
      const picture = pictureHeightOf({ shape: row.shape, width: TILE_WIDTHS[row.shape] })
      return (
        Math.max(view === LIBRARY_VIEWS.tiles ? picture : 0, WORDS_HEIGHT) +
        SIZES.space3 * 2 +
        SIZES.space2
      )
    }
    return (
      pictureHeightOf({ shape: row.shape, width: widthOf(row.shape) }) +
      FOCUS_CAPTION_HEIGHT +
      2 * GROWTH_ROOM
    )
  }
  const { list, rows, toggle, jumpTo } = useGrid({ sections, columnsOf, heightOf, top: 0 })
  const [jumped, setJumped] = useState<string | null>(null)
  const [listHeight, setListHeight] = useState(0)
  const preferred = jumped ?? firstKeyOf(rows)

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
                    onPress={() => onOpen(card)}
                  />
                </View>
              ) : (
                <FocusCard
                  key={card.key}
                  card={card}
                  isPreferred={card.key === preferred}
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
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {line !== null && <Text style={styles.line}>{line}</Text>}
        <View style={styles.toolbar}>{toolbar}</View>
        {jump !== null && (
          <JumpRow jump={jump} onJump={(keys) => setJumped(jumpTo(keys) ?? jumped)} />
        )}
        {notice !== null && <Text style={styles.notice}>{notice}</Text>}
      </View>
      {/* On a TV the fork wraps the list's ScrollView in a TVFocusGuideView that takes no
          style, so `flex` never reaches it: the list is given the height left below the header. */}
      <View
        onLayout={({ nativeEvent }) => setListHeight(nativeEvent.layout.height)}
        style={styles.listSlot}
      >
        <FlatList
          ref={list}
          contentContainerStyle={styles.content}
          data={rows}
          extraData={preferred}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          style={{ height: listHeight }}
        />
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
    gap: SIZES.space2,
    paddingTop: SIZES.space6,
    paddingHorizontal: GUTTER,
    paddingBottom: SIZES.space2,
  },
  title: { color: COLOURS.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  line: { color: COLOURS.muted, fontSize: SIZES.textLg },
  toolbar: { flexDirection: 'row', gap: SIZES.space3 },
  notice: { color: COLOURS.muted, fontSize: SIZES.textLg },
  // A horizontal ScrollView grows by default, which would leave the cards below no room.
  jumpScroll: { flexGrow: 0 },
  jumpRow: { gap: SIZES.space0, paddingVertical: SIZES.space1, alignItems: 'center' },
  unit: { color: COLOURS.muted, fontSize: SIZES.text, paddingRight: SIZES.space1 },
  mark: {
    minWidth: SIZES.controlLarge,
    height: SIZES.controlLarge,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: SIZES.radius,
    borderWidth: SIZES.tvFocusRing,
    borderColor: 'transparent',
  },
  markLabel: { color: COLOURS.muted, fontSize: SIZES.textLg, fontWeight: '600' },
  markEmpty: { color: COLOURS.line },
  focused: { borderColor: COLOURS.text, backgroundColor: COLOURS.quiet },
  listSlot: { flex: 1 },
  content: { paddingHorizontal: GUTTER, paddingBottom: SIZES.space6 },
  bucketRow: { justifyContent: 'center' },
  bucket: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: SIZES.space2,
    minHeight: SIZES.controlLarge,
    paddingHorizontal: SIZES.space3,
    borderRadius: SIZES.radius,
    borderWidth: SIZES.tvFocusRing,
    borderColor: 'transparent',
  },
  chevron: { color: COLOURS.muted, fontSize: SIZES.textLg },
  bucketTitle: { color: COLOURS.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  count: { color: COLOURS.muted, fontSize: SIZES.textLg },
  cards: { flexDirection: 'row', gap: GAP, paddingVertical: GROWTH_ROOM },
  rowCards: { paddingVertical: SIZES.space1 },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SIZES.space3,
    padding: SIZES.space3,
    borderRadius: SIZES.radius,
    borderWidth: SIZES.tvFocusRing,
    borderColor: 'transparent',
  },
  words: { flex: 1 },
  rowTitle: {
    color: COLOURS.text,
    fontSize: SIZES.textLg,
    lineHeight: SIZES.textLg * 1.25,
    fontWeight: '600',
  },
  rowLine: { color: COLOURS.muted, fontSize: SIZES.text, lineHeight: SIZES.text * 1.25 },
})
