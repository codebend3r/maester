import { useEffect, useRef, useState } from 'react'
import type { FlatList } from 'react-native'

import type { CardShape } from '@/queries/cards'
import type { GridSection } from '@/queries/libraryGrid'
import {
  GRID_ROWS,
  type GridRow,
  gridRowsOf,
  isBucket,
  jumpTargetOf,
  offsetOfRow,
} from '@/layouts/gridRows'
import { useReduceMotion } from '@/stores/reduceMotion'

/**
 * What both grids share: the rows the sections cut into, which buckets are open (none, to
 * start, as the web's), and the jump, which scrolls to a card, opening its bucket first and
 * scrolling once the bucket's rows are drawn. `top` is how far down the list its first row
 * starts.
 */
export const useGrid = ({
  sections,
  columnsOf,
  heightOf,
  top,
}: {
  sections: readonly GridSection[]
  columnsOf: (shape: CardShape) => number
  heightOf: (row: GridRow) => number
  top: number
}) => {
  const isReduced = useReduceMotion((state) => state.isReduced)
  const list = useRef<FlatList<GridRow>>(null)
  // A card jumped to in a bucket that was shut, scrolled to once the bucket's rows are drawn.
  const pending = useRef<string | null>(null)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const rows = gridRowsOf({ sections, open, columnsOf })

  const scrollTo = ({ card, shown }: { card: string; shown: readonly GridRow[] }): boolean => {
    const index = shown.findIndex(
      (row) => row.kind === GRID_ROWS.cards && row.cards.some(({ key }) => key === card),
    )
    const shownList = list.current
    if (index === -1 || shownList === null) return false
    shownList.scrollToOffset({
      offset: top + offsetOfRow({ rows: shown, index, heightOf }),
      animated: !isReduced,
    })
    return true
  }

  useEffect(() => {
    const card = pending.current
    if (card !== null && scrollTo({ card, shown: rows })) pending.current = null
  })

  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was)
      if (!next.delete(key)) next.add(key)
      return next
    })

  /** Scrolls to the first card of `keys` the grid shows, and names it; null when there is none. */
  const jumpTo = (keys: ReadonlySet<string>): string | null => {
    const target = jumpTargetOf({ sections, keys })
    if (target === null) return null
    if (scrollTo({ card: target.card, shown: rows })) return target.card
    const section = sections.find(({ key }) => key === target.section)
    if (section !== undefined && isBucket(section)) {
      pending.current = target.card
      setOpen((was) => new Set(was).add(target.section))
    }
    return target.card
  }

  return { list, rows, toggle, jumpTo }
}
