import { JUMP_SCALE_LABELS, type JumpScale, LIBRARY_VIEWS } from '@raven/core'
import { useState } from 'react'
import { FlatList, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Text } from '@/layouts/Text'
import { CARD_SHAPES, type CardShape, type ShelfCard } from '@/queries/cards'
import { CardPicture, pictureHeightOf } from '@/layouts/Card'
import { TouchBack } from '@/layouts/TouchBack'
import { TouchCard, touchCaptionHeightOf } from '@/layouts/TouchCard'
import { fitJumpMarks } from '@/layouts/jumpMarks'
import { BREAKPOINTS } from '@/layouts/screenSizes'
import { LINE_RATIO, linesHeightOf } from '@/layouts/textHeights'
import {
  CHEVRONS,
  type GridKit,
  type GridProps,
  headingLabelOf,
  isRowView,
} from '@/layouts/gridKit'
import { GRID_ROWS, type GridRow, gridColumnsOf } from '@/layouts/gridRows'
import { useGrid } from '@/layouts/useGrid'
import { SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

const GUTTER = SIZES.space3
const GAP = SIZES.space3
const ROW_GAP = SIZES.space4

type LeastWidthOfProps = { shape: CardShape; screen: number }

/**
 * The narrowest card a row holds, as the web's grid has it: posters narrower on a narrower screen.
 */
const leastWidthOf = ({ shape, screen }: LeastWidthOfProps): number => {
  if (shape === CARD_SHAPES.wide) return 240
  if (screen <= BREAKPOINTS.tablet) return 128
  return screen <= BREAKPOINTS.wide ? 150 : 168
}

/** A row of the list and tiles views is at least this wide, so a tablet holds two. */
const LEAST_ROW_WIDTH = 320

/** A tile's picture, by its card's shape. */
const TILE_WIDTHS = { [CARD_SHAPES.poster]: 48, [CARD_SHAPES.wide]: 96 } as const

/** How tall a bucket's heading row stands: a finger's reach, or its title at the viewer's size. */
const headerHeightOf = (fontScale: number): number =>
  Math.max(SIZES.fieldHeight, linesHeightOf({ sizes: [SIZES.textLg], fontScale })) + SIZES.space2

/** How wide the jump strip stands at the right edge, and so the room the cards leave it. */
const STRIP_WIDTH = SIZES.space5

type RowCardProps = {
  card: ShelfCard
  hasPicture: boolean
  onPress: () => void
}

/** A card of the list or tiles view: a row of words, with its picture in the tiles view. */
const RowCard = ({ card, hasPicture, onPress }: RowCardProps) => {
  const styles = useStyles()
  return (
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
}

type JumpStripProps = {
  jump: JumpScale
  room: number
  fontScale: number
  onJump: (keys: ReadonlySet<string>) => void
}

/**
 * A strip down the right edge, as the web's, of the steps the order runs through, fitted to
 * the `room` it has: each step as tall as fits, or neighbouring steps gathered into one where
 * they cannot all be pressed, as on a phone held sideways.
 */
const JumpStrip = ({ jump, room, fontScale, onJump }: JumpStripProps) => {
  const labelHeight = linesHeightOf({ sizes: [SIZES.textXs], fontScale })
  const styles = useStyles()
  const unit = jump.unit === null ? 0 : labelHeight
  const { height, marks } = fitJumpMarks({ scale: jump, room: room - unit, labelHeight })
  return (
    <View accessibilityLabel={JUMP_SCALE_LABELS[jump.field]} style={styles.strip}>
      {jump.unit !== null && <Text style={styles.unit}>{jump.unit}</Text>}
      {marks.map((mark) => (
        <Pressable
          key={mark.key}
          accessibilityLabel={mark.name}
          accessibilityRole="button"
          accessibilityState={{ disabled: mark.keys === null }}
          disabled={mark.keys === null}
          hitSlop={{ left: SIZES.space2 }}
          onPress={() => mark.keys !== null && onJump(mark.keys)}
          style={[styles.mark, { height }]}
        >
          <Text style={[styles.markLabel, mark.keys === null && styles.markEmpty]}>
            {mark.label}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

/**
 * A library under the thumb: the way back, its name and what it holds, its search box and the
 * pickers, then its cards in as many columns as the screen's width fits, the buckets folded
 * until pressed, and the jump strip along the right edge.
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
  onBack,
}: GridProps) => {
  const screen = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const styles = useStyles()
  const [top, setTop] = useState(0)
  // The strip's slot runs between the top and bottom insets; until it is laid out, that is
  // the window's height between them.
  const [stripRoom, setStripRoom] = useState<number | null>(null)
  // The side insets keep the cards and the strip clear of the Dynamic Island and the corners
  // of a phone held sideways.
  const left = GUTTER + insets.left
  const right = GUTTER + (jump === null ? 0 : STRIP_WIDTH) + insets.right
  const isRows = isRowView(view)
  const { columnsOf, widthOf } = gridColumnsOf({
    room: screen.width - left - right,
    gap: GAP,
    leastOf: (shape) => (isRows ? LEAST_ROW_WIDTH : leastWidthOf({ shape, screen: screen.width })),
  })
  const heightOf = (row: GridRow): number => {
    if (row.kind === GRID_ROWS.header) return headerHeightOf(screen.fontScale)
    if (isRows) {
      const picture = pictureHeightOf({ shape: row.shape, width: TILE_WIDTHS[row.shape] })
      const words = linesHeightOf({
        sizes: [SIZES.text, SIZES.textXs],
        fontScale: screen.fontScale,
      })
      return Math.max(view === LIBRARY_VIEWS.tiles ? picture : 0, words) + SIZES.space2 * 2
    }
    return (
      pictureHeightOf({ shape: row.shape, width: widthOf(row.shape) }) +
      touchCaptionHeightOf(screen.fontScale) +
      ROW_GAP
    )
  }
  const { list, rows, toggle, jumpTo } = useGrid({ sections, columnsOf, heightOf, top })

  type RenderRowProps = { item: GridRow }

  const renderRow = ({ item: row }: RenderRowProps) => {
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
        contentContainerStyle={{
          paddingTop: insets.top + SIZES.space2,
          paddingBottom: insets.bottom + SIZES.space5,
          paddingLeft: left,
          paddingRight: right,
        }}
        data={rows}
        keyExtractor={(row) => row.key}
        // The search box sits in the header: a drag puts its keyboard away, and with the
        // keyboard up a card or the clear button still takes the first tap.
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View
            onLayout={({ nativeEvent }) => setTop(nativeEvent.layout.height)}
            style={styles.header}
          >
            <TouchBack onPress={onBack} />
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            {line !== null && <Text style={styles.line}>{line}</Text>}
            {search}
            <View style={styles.toolbar}>{toolbar}</View>
            {notice !== null && <Text style={styles.notice}>{notice}</Text>}
          </View>
        }
        renderItem={renderRow}
        style={styles.ground}
      />
      {jump !== null && (
        <View
          onLayout={({ nativeEvent }) => setStripRoom(nativeEvent.layout.height)}
          pointerEvents="box-none"
          style={[
            styles.stripSlot,
            { top: insets.top, bottom: insets.bottom, right: insets.right },
          ]}
        >
          <JumpStrip
            fontScale={screen.fontScale}
            jump={jump}
            onJump={jumpTo}
            room={stripRoom ?? screen.height - insets.top - insets.bottom}
          />
        </View>
      )}
    </View>
  )
}

/** A library on a phone or tablet. */
export const touchGrid: GridKit = { Grid }

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    header: { gap: SIZES.space2, paddingBottom: SIZES.space4 },
    title: { color: colours.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
    line: { color: colours.muted, fontSize: SIZES.textSm },
    toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: SIZES.space1 },
    notice: { color: colours.muted, fontSize: SIZES.text },
    pressed: { opacity: 0.6 },
    bucket: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space1 },
    chevron: { color: colours.muted, fontSize: SIZES.text, width: SIZES.space3 },
    bucketTitle: {
      flexShrink: 1,
      color: colours.text,
      fontSize: SIZES.textLg,
      lineHeight: SIZES.textLg * LINE_RATIO,
      fontWeight: 'bold',
    },
    count: { color: colours.muted, fontSize: SIZES.textSm },
    cards: { flexDirection: 'row', gap: GAP },
    rowCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SIZES.space2,
      paddingVertical: SIZES.space2,
    },
    words: { flex: 1 },
    rowTitle: {
      color: colours.text,
      fontSize: SIZES.text,
      lineHeight: SIZES.text * LINE_RATIO,
      fontWeight: '600',
    },
    rowLine: {
      color: colours.muted,
      fontSize: SIZES.textXs,
      lineHeight: SIZES.textXs * LINE_RATIO,
    },
    stripSlot: { position: 'absolute', width: STRIP_WIDTH, justifyContent: 'center' },
    strip: { alignItems: 'center' },
    unit: { color: colours.muted, fontSize: SIZES.textXs, lineHeight: SIZES.textXs * LINE_RATIO },
    mark: {
      minWidth: STRIP_WIDTH,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markLabel: {
      color: colours.muted,
      fontSize: SIZES.textXs,
      lineHeight: SIZES.textXs * LINE_RATIO,
      fontWeight: '600',
    },
    markEmpty: { color: colours.line },
  }),
)
