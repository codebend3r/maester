import type { ReactNode } from 'react'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'
import type { TokenStyle } from '@/theme/tokens'
import styles from '@/ui/TileGrid/TileGrid.module.scss'

/** How many tiles a grid's row holds on each layout. */
export type GridColumns = Record<FormFactor, number>

/** A grid's row, as the handoff's grids hold it: two tiles on the narrow layout, five on the wide. */
export const GRID_COLUMNS = {
  [FORM_FACTORS.phone]: 2,
  [FORM_FACTORS.tablet]: 5,
} as const satisfies GridColumns

type RenderTileProps<T> = { item: T }

type TileGridProps<T> = {
  items: readonly T[]
  columns?: GridColumns
  keyOf: (item: T) => string | number
  renderTile: (props: RenderTileProps<T>) => ReactNode
}

/**
 * Tiles in rows filling the width they are given, a row's count by the layout: two under
 * `48rem`, five from there, unless `columns` says otherwise. Each tile fills its column.
 */
export function TileGrid<T>({
  items,
  columns = GRID_COLUMNS,
  keyOf,
  renderTile,
}: TileGridProps<T>) {
  const style: TokenStyle = {
    '--columns-phone': String(columns[FORM_FACTORS.phone]),
    '--columns-tablet': String(columns[FORM_FACTORS.tablet]),
  }
  return (
    <ul className={styles.grid} style={style}>
      {items.map((item) => (
        <li className={styles.cell} key={keyOf(item)}>
          {renderTile({ item })}
        </li>
      ))}
    </ul>
  )
}
