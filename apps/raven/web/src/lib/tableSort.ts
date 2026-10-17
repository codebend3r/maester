import { useState } from 'react'

const TABLE_SORT_DIRECTIONS = { asc: 'asc', desc: 'desc' } as const

export type SortDirection = (typeof TABLE_SORT_DIRECTIONS)[keyof typeof TABLE_SORT_DIRECTIONS]

/** What a column header's `aria-sort` says: which way the table is sorted on it, if at all. */
export const ARIA_SORTS = {
  ascending: 'ascending',
  descending: 'descending',
  none: 'none',
} as const

export type AriaSort = (typeof ARIA_SORTS)[keyof typeof ARIA_SORTS]

/** What a column sorts by, and which way its first click goes. */
export type SortColumn<T> = {
  value: (row: T) => number | string | null
  first: SortDirection
}

export type ActiveSort<K extends string> = { key: K; direction: SortDirection }

type SortValue = ReturnType<SortColumn<unknown>['value']>

const compare = ({ a, b }: { a: SortValue; b: SortValue }): number => {
  if (a == null && b == null) return 0
  // Rows with nothing to sort by go last whichever way the column points.
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
}

/** `rows` in the order `active` asks for; the order they came in when nothing is active. */
export const sortRows = <T, K extends string>({
  rows,
  columns,
  active,
}: {
  rows: readonly T[]
  columns: Record<K, SortColumn<T>>
  active: ActiveSort<K> | null
}): T[] => {
  if (active == null) return [...rows]
  const column = columns[active.key]
  const sign = active.direction === TABLE_SORT_DIRECTIONS.asc ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, value: column.value(row) }))
    .toSorted((a, b) => {
      const byValue = compare({ a: a.value, b: b.value })
      // A missing value sorts last either way; otherwise the direction applies.
      if (a.value == null || b.value == null) return byValue
      return byValue * sign || a.index - b.index
    })
    .map((entry) => entry.row)
}

/** The next sort after a click on `key`: its first direction, then the other, then off. */
export const nextSort = <K extends string>({
  active,
  key,
  first,
}: {
  active: ActiveSort<K> | null
  key: K
  first: SortDirection
}): ActiveSort<K> | null => {
  if (active?.key !== key) return { key, direction: first }
  if (active.direction === first) {
    return {
      key,
      direction:
        first === TABLE_SORT_DIRECTIONS.asc
          ? TABLE_SORT_DIRECTIONS.desc
          : TABLE_SORT_DIRECTIONS.asc,
    }
  }
  return null
}

/** Click-to-sort state for a table whose rows are all loaded. */
export const useTableSort = <T, K extends string>({
  rows,
  columns,
}: {
  rows: readonly T[]
  columns: Record<K, SortColumn<T>>
}): {
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
