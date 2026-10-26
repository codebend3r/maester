import { Component, type ReactNode, useEffect, useRef } from 'react'
import { NavigationType, useLocation, useNavigationType } from 'react-router-dom'
import { holdInPlace } from '@/lib/holdInPlace'

/** The card at the top of a page: its place among the page's cards, its key, and how far down the screen it sat. */
type TopCard = { index: number; entry: string; top: number }

/**
 * The card at the top of each page left behind, by its history entry's key.
 * Kept outside any component: the player sits outside the shell, so playing
 * a video unmounts the shell, and Back mounts it again.
 */
const topCards = new Map<string, TopCard>()

/** A card (`data-entry`) that is on show, not folded away in a closed bucket. */
export const ENTRY_SELECTOR = '[data-entry]:not(details:not([open]) *)'

/** The page's cards in the order it stacks them down the screen, but for those folded away in a closed bucket. */
const cardsOnPage = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(ENTRY_SELECTOR))

type FirstBelowTopProps = {
  cards: readonly HTMLElement[]
  low: number
  high: number
}

/** Where among `cards` the first to reach below the top of the screen is, found by halves. */
const firstBelowTop = ({ cards, low, high }: FirstBelowTopProps): number => {
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
  if (!card) return null
  return { index, entry: card.dataset.entry ?? '', top: card.getBoundingClientRect().top }
}

/** Notes the card at the top of the page on screen, for the history entry `key`. */
const noteTopCard = (key: string): void => {
  const card = topCard()
  if (card) topCards.set(key, card)
  else topCards.delete(key)
}

type TopCardNoteProps = { pageKey: string; children: ReactNode }

/**
 * Notes the card at the top of the page as the page changes, around the
 * shell's outlet. React calls `getSnapshotBeforeUpdate` with the page left
 * still in the document and the browser not yet scrolled for the next one,
 * a moment no hook has: the browser's own Back re-renders inside the
 * router's popstate listener, before any listener added later runs.
 * Leaving the shell, as playing a video does, notes the page on unmount.
 */
export class TopCardNote extends Component<TopCardNoteProps> {
  getSnapshotBeforeUpdate(previous: Readonly<TopCardNoteProps>): null {
    if (previous.pageKey !== this.props.pageKey) noteTopCard(previous.pageKey)
    return null
  }

  // React asks for it beside getSnapshotBeforeUpdate, which hands it the snapshot.
  componentDidUpdate(): void {}

  componentWillUnmount(): void {
    noteTopCard(this.props.pageKey)
  }

  render(): ReactNode {
    return this.props.children
  }
}

/**
 * A page opened by a link starts at its top, rather than wherever the last
 * one was scrolled to. A change to the address's query alone, as a sort or
 * search writes, is the same page, so it stays put. Back and forward leave
 * the scroll to the browser, which puts back how far down the page was. A
 * grid skips its offscreen cards, though, standing them in at an estimate
 * of their height (`content-visibility`), so that distance can land on
 * other cards: the card that was at the top, as `TopCardNote` noted it on
 * the way out, goes back where it was.
 */
export const useScrollReset = (): void => {
  const { pathname, key } = useLocation()
  const navigationType = useNavigationType()
  const shown = useRef(pathname)

  useEffect(() => {
    if (shown.current === pathname) return
    shown.current = pathname
    if (navigationType !== NavigationType.Pop) window.scrollTo({ top: 0 })
  }, [pathname, navigationType])

  // A second quick Back stops the hold the first started, so two never
  // fight over the scroll; so does leaving the shell. Not the effect's
  // cleanup: a library page writes its search into the address as it
  // arrives, with replace, which changes the key while the hold must go on.
  const holding = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (navigationType !== NavigationType.Pop) return
    holding.current?.()
    holding.current = null
    const card = topCards.get(key)
    if (!card) return
    // Only the same card in the same place among the page's cards: a list
    // dealt again, or with a bucket folded that was open, is left to the browser.
    const element = cardsOnPage()[card.index]
    if (!element || element.dataset.entry !== card.entry) return
    holding.current = holdInPlace({ card: element, top: card.top })
  }, [key, navigationType])
  useEffect(() => () => holding.current?.(), [])
}
