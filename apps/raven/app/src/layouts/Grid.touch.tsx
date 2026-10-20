import { JUMP_SCALE_LABELS, type JumpScale, LIBRARY_VIEWS } from '@raven/core'
import { useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { CARD_SHAPES, type CardShape, type ShelfCard } from '@/queries/cards'
import { CardPicture, pictureHeightOf } from '@/layouts/Card'
import { TOUCH_CAPTION_HEIGHT, TouchCard } from '@/layouts/TouchCard'
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

const GUTTER = SIZES.space3
const GAP = SIZES.space3
const ROW_GAP = SIZES.space4

/** The narrowest card a row holds, as the web's grid has it: posters narrower on a narrower screen. */
const leastWidthOf = ({ shape, screen }: { shape: CardShape; screen: number }): number => {
  if (shape === CARD_SHAPES.wide) return 240
  if (screen <= 48 * 16) return 128
  return screen <= 64 * 16 ? 150 : 168
}

/** A row of the list and tiles views is at least this wide, so a tablet holds two. */
const LEAST_ROW_WIDTH = 320

/** A tile's picture, by its card's shape. */
const TILE_WIDTHS = { [CARD_SHAPES.poster]: 48, [CARD_SHAPES.wide]: 96 } as const

const HEADER_HEIGHT = SIZES.fieldHeight + SIZES.space2
const WORDS_HEIGHT = SIZES.text * 1.25 + SIZES.textXs * 1.25

/** How wide the jump strip stands at the right edge, and so the room the cards leave it. */
const STRIP_WIDTH = SIZES.space5

/** How many points each of a strip's marks stands, the alphabet's 27 fitting a small phone. */
const MARK_HEIGHT = 18

/** The way back, and what it is called aloud without its arrow. */
const BACK = { text: '\u2039 Back', label: 'Back' } as const

/** A card of the list or tiles view: a row of words, with its picture in the tiles view. */
const RowCard = ({
  card,
  hasPicture,
  onPress,
}: {
  card: ShelfCard
  hasPicture: boolean
  onPress: () => void
}) => (
  <Pressable
    accessibilityLabel={card.title}
    accessibilityRole="button"
    onPress={onPress}
    style={({ pressed }) => [styles.rowCard, pressed && styles.pressed]}
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

/** A strip down the right edge, as the web's, of the steps the order runs through. */
const JumpStrip = ({
  jump,
  onJump,
}: {
  jump: JumpScale
  onJump: (keys: ReadonlySet<string>) => void
}) => (
  <View accessibilityLabel={JUMP_SCALE_LABELS[jump.field]} style={styles.strip}>
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
          hitSlop={{ left: SIZES.space2 }}
          onPress={() => keys !== undefined && onJump(keys)}
          style={styles.mark}
        >
          <Text style={[styles.markLabel, keys === undefined && styles.markEmpty]}>
            {mark.label}
          </Text>
        </Pressable>
      )
    })}
  </View>
)

/**
 * A library under the thumb: the way back, its name and what it holds, the pickers, then its
 * cards in as many columns as the screen's width fits, the buckets folded until pressed, and
 * the jump strip along the right edge.
 */
const Grid = ({
  title,
  line,
  notice,
  toolbar,
  sections,
  view,
  jump,
  onOpen,
  onBack,
}: GridProps) => {
  const screen = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [top, setTop] = useState(0)
  const room = screen.width - 2 * GUTTER - (jump === null ? 0 : STRIP_WIDTH)
  const isRows = isRowView(view)
  const columnsOf = (shape: CardShape) =>
    columnsFor({
      width: room,
      least: isRows ? LEAST_ROW_WIDTH : leastWidthOf({ shape, screen: screen.width }),
      gap: GAP,
    })
  const widthOf = (shape: CardShape) => {
    const columns = columnsOf(shape)
    return (room - (columns - 1) * GAP) / columns
  }
  const heightOf = (row: GridRow): number => {
    if (row.kind === GRID_ROWS.header) return HEADER_HEIGHT
    if (isRows) {
      const picture = pictureHeightOf({ shape: row.shape, width: TILE_WIDTHS[row.shape] })
      return Math.max(view === LIBRARY_VIEWS.tiles ? picture : 0, WORDS_HEIGHT) + SIZES.space2 * 2
    }
    return (
      pictureHeightOf({ shape: row.shape, width: widthOf(row.shape) }) +
      TOUCH_CAPTION_HEIGHT +
      ROW_GAP
    )
  }
  const { list, rows, toggle, jumpTo } = useGrid({ sections, columnsOf, heightOf, top })

  const renderRow = ({ item: row }: { item: GridRow }) => {
    switch (row.kind) {
      case GRID_ROWS.header:
        return (
          <Pressable
            accessibilityLabel={headingLabelOf(row.section)}
            accessibilityRole="button"
            accessibilityState={{ expanded: row.isOpen }}
            onPress={() => toggle(row.key)}
            style={({ pressed }) => [
              styles.bucket,
              { height: heightOf(row) },
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.chevron}>{row.isOpen ? CHEVRONS.open : CHEVRONS.shut}</Text>
            <Text numberOfLines={1} style={styles.bucketTitle}>
              {row.section.title}
            </Text>
            <Text style={styles.count}>{row.section.count}</Text>
          </Pressable>
        )
      case GRID_ROWS.cards:
        return (
          <View style={[styles.cards, { height: heightOf(row) }]}>
            {row.cards.map((card) =>
              isRows ? (
                <View key={card.key} style={{ width: widthOf(row.shape) }}>
                  <RowCard
                    card={card}
                    hasPicture={view === LIBRARY_VIEWS.tiles}
                    onPress={() => onOpen(card)}
                  />
                </View>
              ) : (
                <TouchCard
                  key={card.key}
                  card={card}
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
      <FlatList
        ref={list}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + SIZES.space2,
            paddingBottom: insets.bottom + SIZES.space5,
            paddingRight: GUTTER + (jump === null ? 0 : STRIP_WIDTH),
          },
        ]}
        data={rows}
        keyExtractor={(row) => row.key}
        ListHeaderComponent={
          <View
            onLayout={({ nativeEvent }) => setTop(nativeEvent.layout.height)}
            style={styles.header}
          >
            <Pressable
              accessibilityLabel={BACK.label}
              accessibilityRole="button"
              hitSlop={SIZES.space2}
              onPress={onBack}
              style={({ pressed }) => [styles.back, pressed && styles.pressed]}
            >
              <Text style={styles.backLabel}>{BACK.text}</Text>
            </Pressable>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            {line !== null && <Text style={styles.line}>{line}</Text>}
            <View style={styles.toolbar}>{toolbar}</View>
            {notice !== null && <Text style={styles.notice}>{notice}</Text>}
          </View>
        }
        renderItem={renderRow}
        style={styles.ground}
      />
      {jump !== null && (
        <View
          pointerEvents="box-none"
          style={[styles.stripSlot, { top: insets.top, bottom: insets.bottom }]}
        >
          <JumpStrip jump={jump} onJump={jumpTo} />
        </View>
      )}
    </View>
  )
}

/** A library on a phone or tablet. */
export const touchGrid: GridKit = { Grid }

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: COLOURS.ground },
  content: { paddingLeft: GUTTER },
  header: { gap: SIZES.space2, paddingBottom: SIZES.space4 },
  back: { alignSelf: 'flex-start', minHeight: SIZES.fieldHeight, justifyContent: 'center' },
  backLabel: { color: COLOURS.muted, fontSize: SIZES.text },
  title: { color: COLOURS.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  line: { color: COLOURS.muted, fontSize: SIZES.textSm },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: SIZES.space1 },
  notice: { color: COLOURS.muted, fontSize: SIZES.text },
  pressed: { opacity: 0.6 },
  bucket: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space1 },
  chevron: { color: COLOURS.muted, fontSize: SIZES.text, width: SIZES.space3 },
  bucketTitle: { flexShrink: 1, color: COLOURS.text, fontSize: SIZES.textLg, fontWeight: 'bold' },
  count: { color: COLOURS.muted, fontSize: SIZES.textSm },
  cards: { flexDirection: 'row', gap: GAP },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SIZES.space2,
    paddingVertical: SIZES.space2,
  },
  words: { flex: 1 },
  rowTitle: {
    color: COLOURS.text,
    fontSize: SIZES.text,
    lineHeight: SIZES.text * 1.25,
    fontWeight: '600',
  },
  rowLine: { color: COLOURS.muted, fontSize: SIZES.textXs, lineHeight: SIZES.textXs * 1.25 },
  stripSlot: { position: 'absolute', right: 0, width: STRIP_WIDTH, justifyContent: 'center' },
  strip: { alignItems: 'center' },
  unit: { color: COLOURS.muted, fontSize: SIZES.textXs },
  mark: {
    height: MARK_HEIGHT,
    minWidth: STRIP_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markLabel: { color: COLOURS.muted, fontSize: SIZES.textXs, fontWeight: '600' },
  markEmpty: { color: COLOURS.line },
})
