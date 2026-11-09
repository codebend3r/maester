import { type ReactNode, useRef, useState } from 'react'

import { CardMenu } from '@/cardMenu/CardMenu'
import { useLongSelect } from '@/cardMenu/useLongSelect'
import type { CardMenuKit } from '@/layouts/cardMenuKit'
import type { ShelfCard } from '@/queries/cards'

/**
 * How long after a held select a press on the same card is the hold's own tail: Android
 * reports the key coming up after a long press as a click too, which would open the card.
 */
const HELD_PRESS_MS = 1000

type UseCardMenuProps = { card: Pick<ShelfCard, 'title' | 'subject'>; kit: CardMenuKit }

type CardMenuState = {
  /** Whether the remote is on the card, which the card draws its ring and growth from. */
  isFocused: boolean
  /** The card's focus handlers: the menu listens for a held select only while the card has the focus. */
  onFocus: () => void
  onBlur: () => void
  /** The menu, drawn inside the card while it is open; null while it is not. */
  menu: ReactNode
  /** `onPress`, unless the press is the tail of the hold that opened the menu. */
  guard: (onPress: () => void) => () => void
}

/**
 * The menu a card opens on a held select while it has the focus, the focus it keeps for that,
 * and a guard for the card's press. A card with no subject opens none, and hears no held select.
 */
export const useCardMenu = ({ card, kit }: UseCardMenuProps): CardMenuState => {
  const [isFocused, setFocused] = useState(false)
  const [isOpen, setOpen] = useState(false)
  const heldAt = useRef<number | null>(null)
  const { subject } = card
  useLongSelect({
    isListening: isFocused && subject !== null && !isOpen,
    onLongSelect: () => {
      heldAt.current = Date.now()
      setOpen(true)
    },
  })
  const isHeldTail = (): boolean =>
    heldAt.current !== null && Date.now() - heldAt.current < HELD_PRESS_MS
  return {
    isFocused,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    menu: isOpen && subject !== null && (
      <CardMenu kit={kit} onClose={() => setOpen(false)} subject={subject} title={card.title} />
    ),
    guard: (onPress) => () => {
      if (!isHeldTail()) onPress()
    },
  }
}
