import { type ReactNode, useCallback, useState } from 'react'

import { CardMenu } from '@/cardMenu/CardMenu'
import { touchCardMenu } from '@/layouts/CardMenu.touch'
import type { ShelfCard } from '@/queries/cards'

type UseTouchCardProps = { card: Pick<ShelfCard, 'title' | 'subject'> }

type TouchCard = {
  /** The card's `onLongPress`; undefined for a card that stands for nothing, which leaves a hold to the system. */
  onLongPress: (() => void) | undefined
  /** The menu, drawn inside the card while it is held: the system's sheet, opened once the title is read. */
  menu: ReactNode
}

/**
 * What a card under the thumb does with a long press, whatever it looks like: it opens the
 * card's menu, the TV card's, as the system's action sheet. A card with no subject (a saga, an
 * artist, a playlist, a library) opens none.
 */
export const useTouchCard = ({ card }: UseTouchCardProps): TouchCard => {
  const [isHeld, setHeld] = useState(false)
  const { subject } = card
  // Stable, so the sheet's effect runs once per hold rather than on every render.
  const onClose = useCallback(() => setHeld(false), [])
  return {
    onLongPress: subject === null ? undefined : () => setHeld(true),
    menu: isHeld && subject !== null && (
      <CardMenu kit={touchCardMenu} onClose={onClose} subject={subject} title={card.title} />
    ),
  }
}
