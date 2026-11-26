import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { notedTopIndex } from '@/lib/useScrollReset'

/** How many of a list's cards draw before its page shows: more than the widest screen holds at once. */
const FIRST_CARDS = 60

/** How many more draw each frame after, few enough that no frame waits long on them. */
const CARDS_PER_FRAME = 120

type UseDrawnFirstProps<Item> = {
  items: readonly Item[]
  /** How many draw first, when a list shows fewer at once than a grid: a shelf's one row. */
  first?: number
}

/**
 * The part of `items` to draw now. A library lists thousands of cards, and
 * drawing every one before the page showed kept a page from showing for a
 * second or more each time it opened, its data and pictures already
 * cached. The page shows with the first cards, and the rest follow a batch
 * a frame, small enough that a click or keypress waits on none for long.
 * Not in a transition: the router opens a page in one, and React holds a
 * transition back until those before it are done, so leaving a page
 * would wait for all its batches. Back to a page draws first as far
 * as the card that was at the top when it was left and `first` past it,
 * so the scroll is put back on that card as before. That place counts every
 * card on the page, so on a page of several lists, as Home's shelves, each
 * list before that card draws in full with the page.
 */
export const useDrawnFirst = <Item>({
  items,
  first = FIRST_CARDS,
}: UseDrawnFirstProps<Item>): readonly Item[] => {
  const { key } = useLocation()
  const [count, setCount] = useState(() => (notedTopIndex(key) ?? 0) + first)
  const isDrawn = count >= items.length
  // Runs again on each batch drawn, until the count covers every item.
  useEffect(() => {
    if (count >= items.length) return
    const frame = requestAnimationFrame(() => setCount((drawn) => drawn + CARDS_PER_FRAME))
    return () => cancelAnimationFrame(frame)
  }, [count, items.length])
  return isDrawn ? items : items.slice(0, count)
}
