import { COVER_SIZES, type CoverSize } from '@raven/wren'
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

/** Each cover size as the least width a tile is given. */
const TILE_SIZES = {
  [COVER_SIZES.extraSmall]: 'var(--size-cover-extra-small)',
  [COVER_SIZES.small]: 'var(--size-cover-small)',
  [COVER_SIZES.medium]: 'var(--size-cover-medium)',
  [COVER_SIZES.large]: 'var(--size-cover-large)',
  [COVER_SIZES.extraLarge]: 'var(--size-cover-extra-large)',
} as const satisfies Record<CoverSize, string>

type TileGridProps<T> = {
  items: readonly T[]
  columns?: GridColumns
  /** Fits as many tiles a row as this size allows, in place of `columns`: Albums' cover size. */
  tileSize?: CoverSize
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
  tileSize,
  keyOf,
  renderTile,
}: TileGridProps<T>) {
  const style: TokenStyle = {
    '--columns-phone': String(columns[FORM_FACTORS.phone]),
    '--columns-tablet': String(columns[FORM_FACTORS.tablet]),
    ...(tileSize === undefined ? {} : { '--tile-size': TILE_SIZES[tileSize] }),
  }
  return (
    <ul className={tileSize === undefined ? styles.grid : styles.fitted} style={style}>
      {items.map((item) => (
        <li className={styles.cell} key={keyOf(item)}>
          {renderTile({ item })}
        </li>
      ))}
    </ul>
  )
}
