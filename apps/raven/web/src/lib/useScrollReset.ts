import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { holdInPlace } from '@/lib/holdInPlace'

/** How long the page has to stop scrolling before the card at its top is noted. */
const SETTLE_MS = 100

/** The card at the top of a page: its place among the page's cards, its key, and how far down the screen it sat. */
type TopCard = { index: number; entry: string; top: number }

/** The page's cards in the order it stacks them down the screen, but for those folded away in a closed bucket. */
const cardsOnPage = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-entry]:not(details:not([open]) *)'))

/** Where among `cards` the first to reach below the top of the screen is, found by halves. */
const firstBelowTop = ({
  cards,
  low,
  high,
}: {
  cards: readonly HTMLElement[]
  low: number
  high: number
}): number => {
  if (low >= high) return low
  const middle = Math.floor((low + high) / 2)
  const isBelow = (cards[middle]?.getBoundingClientRect().bottom ?? 0) > 0
  return isBelow
    ? firstBelowTop({ cards, low, high: middle })
    : firstBelowTop({ cards, low: middle + 1, high })
}

/** The first card reaching below the top of the screen, and how far down it sits. */
const topCard = (): TopCard | null => {
  const cards = cardsOnPage()
  const index = firstBelowTop({ cards, low: 0, high: cards.length })
  const card = cards[index]
  const entry = card?.dataset.entry
  if (!card || entry == null) return null
  return { index, entry, top: card.getBoundingClientRect().top }
}

/**
 * A page opened by a link starts at its top, rather than wherever the last
 * one was scrolled to. A change to the address's query alone, as a sort or
 * search writes, is the same page, so it stays put. Back and forward leave
 * the scroll to the browser, which puts back how far down the page was. A
 * grid skips its offscreen cards, though, standing them in at an estimate
 * of their height (`content-visibility`), so that distance can land on
 * other cards: the card that was at the top goes back where it was.
 */
export const useScrollReset = (): void => {
  const { pathname, key } = useLocation()
  const navigationType = useNavigationType()
  const shown = useRef(pathname)
  const topCards = useRef(new Map<string, TopCard>())

  useEffect(() => {
    if (shown.current === pathname) return
    shown.current = pathname
    if (navigationType !== 'POP') window.scrollTo({ top: 0 })
  }, [pathname, navigationType])

  // Noted as the page settles after a scroll, and on a click, which may lead
  // away before it has.
  useEffect(() => {
    const listening = new AbortController()
    const note = () => {
      const card = topCard()
      if (card) topCards.current.set(key, card)
      else topCards.current.delete(key)
    }
    let settling: ReturnType<typeof setTimeout> | undefined
    window.addEventListener(
      'scroll',
      () => {
        clearTimeout(settling)
        settling = setTimeout(note, SETTLE_MS)
      },
      { passive: true, signal: listening.signal },
    )
    document.addEventListener('click', note, { capture: true, signal: listening.signal })
    return () => {
      clearTimeout(settling)
      listening.abort()
    }
  }, [key])

  useEffect(() => {
    if (navigationType !== 'POP') return
    const card = topCards.current.get(key)
    if (!card) return
    // Only the same card in the same place among the page's cards: a list
    // dealt again, or with a bucket folded that was open, is left to the browser.
    const element = cardsOnPage()[card.index]
    if (!element || element.dataset.entry !== card.entry) return
    holdInPlace({ card: element, top: card.top })
  }, [key, navigationType])
}
