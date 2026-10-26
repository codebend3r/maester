import {
  ARIA_SORTS,
  type ActiveSort,
  type AriaSort,
  type SortColumn,
  TABLE_SORT_DIRECTIONS,
  nextSort,
  sortRows,
} from '@raven/core'
import { useState } from 'react'

type UseTableSortProps<T, K extends string> = {
  rows: readonly T[]
  columns: Record<K, SortColumn<T>>
}

/** Click-to-sort state for a table whose rows are all loaded. */
export const useTableSort = <T, K extends string>({
  rows,
  columns,
}: UseTableSortProps<T, K>): {
  sorted: T[]
  active: ActiveSort<K> | null
  toggle: (key: K) => void
  ariaSort: (key: K) => AriaSort
} => {
  const [active, setActive] = useState<ActiveSort<K> | null>(null)
  return {
    sorted: sortRows({ rows, columns, active }),
    active,
    toggle: (key) =>
      setActive((current) => nextSort({ active: current, key, first: columns[key].first })),
    ariaSort: (key) => {
      if (active?.key !== key) return ARIA_SORTS.none
      return active.direction === TABLE_SORT_DIRECTIONS.asc
        ? ARIA_SORTS.ascending
        : ARIA_SORTS.descending
    },
  }
}
