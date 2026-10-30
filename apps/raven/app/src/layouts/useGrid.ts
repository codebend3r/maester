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
  rowOffsetsOf,
} from '@/layouts/gridRows'
import { useReduceMotion } from '@/stores/reduceMotion'

type UseGridProps = {
  sections: readonly GridSection[]
  columnsOf: (shape: CardShape) => number
  heightOf: (row: GridRow) => number
  top: number
}

/**
 * What both grids share: the rows the sections cut into, which buckets are open (none, to
 * start, as the web's), and the jump, which scrolls to a card, opening its bucket first and
 * scrolling once the bucket's rows are drawn. `top` is how far down the list its first row
 * starts.
 */
export const useGrid = ({ sections, columnsOf, heightOf, top }: UseGridProps) => {
  const isReduced = useReduceMotion((state) => state.isReduced)
  const list = useRef<FlatList<GridRow>>(null)
  // A card jumped to in a bucket that was shut, scrolled to once the bucket's rows are drawn.
  const pending = useRef<string | null>(null)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const rows = gridRowsOf({ sections, open, columnsOf })
  // Where each row sits, so a jump scrolls straight to a row the list has not drawn yet.
  const offsets = rowOffsetsOf({ rows, heightOf })

  const scrollTo = (card: string): boolean => {
    const index = rows.findIndex(
      (row) => row.kind === GRID_ROWS.cards && row.cards.some(({ key }) => key === card),
    )
    const shownList = list.current
    if (index === -1 || shownList === null) return false
    shownList.scrollToOffset({ offset: top + (offsets[index] ?? 0), animated: !isReduced })
    return true
  }

  /** Each row's place, for a list that draws only the rows near the screen. */
  const getItemLayout = (_: unknown, index: number) => {
    const offset = offsets[index] ?? 0
    return { index, offset: top + offset, length: (offsets[index + 1] ?? offset) - offset }
  }

  useEffect(() => {
    const card = pending.current
    if (card !== null && scrollTo(card)) pending.current = null
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
    if (scrollTo(target.card)) return target.card
    const section = sections.find(({ key }) => key === target.section)
    if (section !== undefined && isBucket(section)) {
      pending.current = target.card
      setOpen((was) => new Set(was).add(target.section))
    }
    return target.card
  }

  return { list, rows, toggle, jumpTo, getItemLayout }
}
