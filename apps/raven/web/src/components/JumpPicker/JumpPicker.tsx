import type { RefObject } from 'react'
import { holdInPlace } from '@/lib/holdInPlace'
import type { JumpScale } from '@/lib/jumpScale'
import styles from '@/components/JumpPicker/JumpPicker.module.scss'

/** What the strip is called aloud, by what it jumps by. */
const NAMES: Record<JumpScale['field'], string> = {
  title: 'Jump to a letter',
  added: 'Jump to when videos came',
  changed: 'Jump to when videos changed',
  size: 'Jump to a size',
  bitrate: 'Jump to a bitrate',
  resolution: 'Jump to a resolution',
  release: 'Jump to a year',
  rating: 'Jump to a score',
}

/** A link the keyboard reaches: not a picture link hidden from it and from screen readers. */
const FOCUSABLE_LINK = 'a[href]:not([aria-hidden="true"]):not([tabindex="-1"])'

/**
 * Brings the first card under a mark into view: whichever of `keys` the
 * page shows first, as a list re-sorted by its headers shows them in its
 * own order. A folded bucket holding it opens first. The card's first link
 * the keyboard can reach takes the focus, so the keyboard carries on from
 * there; a picture link kept out of the tab order is passed over. Once
 * there, the card is held at the top while the cards around it are drawn.
 */
const jumpTo = ({
  scope,
  keys,
}: {
  scope: HTMLElement | null
  keys: ReadonlySet<string>
}): void => {
  const entry = [...(scope?.querySelectorAll<HTMLElement>('[data-entry]') ?? [])].find((card) =>
    keys.has(card.dataset.entry ?? ''),
  )
  if (!entry) return
  const bucket = entry.closest('details')
  if (bucket) bucket.open = true
  const smooth = window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  entry.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  entry.querySelector<HTMLElement>(FOCUSABLE_LINK)?.focus({ preventScroll: true })
  holdInPlace({ card: entry, top: 0, afterScroll: smooth })
}

/**
 * A strip down the right edge of the screen, where it stays as the page
 * scrolls, of the steps the listing's order runs through: the alphabet for
 * titles, round steps of bitrate or size under their unit, years, scores
 * or months. A step jumps to the first card under it; a step no card falls
 * under is there but cannot be pressed, so the strip keeps its shape.
 * `scope` is what holds the cards, each marked with its `data-entry`.
 */
export const JumpPicker = ({
  scale,
  scope,
}: {
  scale: JumpScale
  scope: RefObject<HTMLElement | null>
}) => (
  <nav className={styles.picker} aria-label={NAMES[scale.field]}>
    {scale.unit && (
      <p className={styles.unit} aria-hidden="true">
        {scale.unit}
      </p>
    )}
    <ol className={styles.marks}>
      {scale.marks.map((mark) => {
        const keys = scale.entries.get(mark.key)
        return (
          <li key={mark.key} className={styles.item}>
            <button
              type="button"
              className={styles.mark}
              disabled={!keys}
              aria-label={mark.name}
              onClick={() => keys && jumpTo({ scope: scope.current, keys })}
            >
              {mark.label}
            </button>
          </li>
        )
      })}
    </ol>
  </nav>
)
