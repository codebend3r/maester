import { useEffect, useRef } from 'react'
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text } from 'react-native'

import { OPACITIES, PALETTE, SIZES } from '@/theme/wrenTheme'

/** What a segment stands for: a list's name, or a setting's value. */
export type SegmentKey = string | number | null

type Segment<K extends SegmentKey> = { key: K; label: string }

type Span = { x: number; width: number }

type SegmentsProps<K extends SegmentKey> = {
  segments: readonly Segment<K>[]
  selected: K
  onSelect: (key: K) => void
}

/**
 * A row of tabs picking which list a page shows, or which value a setting takes. Every label
 * keeps the theme's size: a row too wide for the screen scrolls, with the selected tab kept in
 * view, rather than shrinking a label.
 */
export function Segments<K extends SegmentKey>({ segments, selected, onSelect }: SegmentsProps<K>) {
  const scroller = useRef<ScrollViewInstance>(null)
  const viewportWidth = useRef(0)
  const spans = useRef(new Map<string, Span>())
  // Centred when the row overflows; a row that fits clamps back to the start. Layout events
  // arrive in no fixed order, so the tab and the row each ask again once they are measured.
  const revealSelected = () => {
    const span = spans.current.get(String(selected))
    if (span === undefined || viewportWidth.current === 0) return
    scroller.current?.scrollTo({
      x: Math.max(0, span.x + span.width / 2 - viewportWidth.current / 2),
      animated: false,
    })
  }
  useEffect(revealSelected, [selected])
  return (
    <ScrollView
      accessibilityRole="tablist"
      contentContainerStyle={styles.segments}
      horizontal
      onLayout={({ nativeEvent }) => {
        viewportWidth.current = nativeEvent.layout.width
        revealSelected()
      }}
      ref={scroller}
      showsHorizontalScrollIndicator={false}
      style={styles.scroller}
    >
      {segments.map(({ key, label }) => {
        const isSelected = key === selected
        return (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            key={String(key)}
            onLayout={({ nativeEvent: { layout } }) => {
              spans.current.set(String(key), { x: layout.x, width: layout.width })
              if (isSelected) revealSelected()
            }}
            onPress={() => onSelect(key)}
            style={({ pressed }) => [
              styles.segment,
              isSelected && styles.selected,
              pressed && styles.pressed,
            ]}
          >
            <Text numberOfLines={1} style={[styles.label, isSelected && styles.selectedLabel]}>
              {label}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroller: { backgroundColor: PALETTE.raised, borderRadius: SIZES.radius, flexGrow: 0 },
  segments: { flexGrow: 1, gap: SIZES.space1, padding: SIZES.space1 },
  segment: {
    alignItems: 'center',
    borderRadius: SIZES.radius,
    flexGrow: 1,
    flexShrink: 0,
    justifyContent: 'center',
    minHeight: SIZES.fieldHeight,
    paddingHorizontal: SIZES.space3,
  },
  selected: { backgroundColor: PALETTE.quiet },
  label: { color: PALETTE.muted, fontSize: SIZES.textSm, fontWeight: 'bold' },
  selectedLabel: { color: PALETTE.text },
  pressed: { opacity: OPACITIES.pressed },
})
