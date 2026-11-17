import { type ReactNode, useState } from 'react'
import { type LayoutChangeEvent, StyleSheet, View, useWindowDimensions } from 'react-native'

import { usePageInsets } from '@/shell/useShell'
import { useFormFactor } from '@/theme/wrenTheme'
import { SIZE, SPACE, FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { tileWidthOf } from '@/ui/tileWidth'

/** How many tiles a grid's row holds on each form factor. */
export type GridColumns = Record<FormFactor, number>

/** A grid's row, as the handoff's grids hold it: two tiles on a phone, five on a tablet. */
export const GRID_COLUMNS = {
  [FORM_FACTORS.phone]: 2,
  [FORM_FACTORS.tablet]: 5,
} as const satisfies GridColumns

/** The gap between tiles, across a row. */
export const GRID_GAP = SIZE.rowGap

const styles = StyleSheet.create({
  grid: { columnGap: GRID_GAP, flexDirection: 'row', flexWrap: 'wrap', rowGap: SPACE.s5 },
})

/** The width inside the page's padding, until something has been measured. */
const useInnerWidth = (): number => {
  const screen = useWindowDimensions()
  const { paddingLeft, paddingRight } = usePageInsets()
  return screen.width - paddingLeft - paddingRight
}

type UseGridProps = { columns?: GridColumns }

/**
 * A virtualized grid's columns and tile width inside the page's padding, for a `FlatList` of
 * `numColumns`. It measures the list it is handed `onLayout` by, so a tablet's sidebar is never
 * counted, and starts from the window until it has.
 */
export const useGrid = ({ columns = GRID_COLUMNS }: UseGridProps = {}) => {
  const count = columns[useFormFactor()]
  const insets = usePageInsets()
  const guess = useInnerWidth()
  const [measured, setMeasured] = useState<number | null>(null)
  const width = measured === null ? guess : measured - insets.paddingLeft - insets.paddingRight
  return {
    columns: count,
    tileWidth: tileWidthOf({ width, columns: count, gap: GRID_GAP }),
    onLayout: (event: LayoutChangeEvent) => setMeasured(event.nativeEvent.layout.width),
  }
}

type RenderTileProps<T> = { item: T; width: number }

type TileGridProps<T> = {
  items: readonly T[]
  columns?: GridColumns
  keyOf: (item: T) => string | number
  renderTile: (props: RenderTileProps<T>) => ReactNode
}

/**
 * Tiles in rows filling the width they are given, a row's count by the form factor: a short,
 * whole grid inside a page that scrolls. It measures itself, and starts from the page's width.
 */
export function TileGrid<T>({
  items,
  columns = GRID_COLUMNS,
  keyOf,
  renderTile,
}: TileGridProps<T>) {
  const count = columns[useFormFactor()]
  const guess = useInnerWidth()
  const [measured, setMeasured] = useState<number | null>(null)
  const width = tileWidthOf({ width: measured ?? guess, columns: count, gap: GRID_GAP })
  return (
    <View onLayout={(event) => setMeasured(event.nativeEvent.layout.width)} style={styles.grid}>
      {width > 0 &&
        items.map((item) => <View key={keyOf(item)}>{renderTile({ item, width })}</View>)}
    </View>
  )
}
