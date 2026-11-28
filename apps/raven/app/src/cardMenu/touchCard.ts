import type { ReactNode } from 'react'

/** What a card under the thumb does with a long press; a `.ts` of its own so the bun tests' modules can name it. */
export type TouchCard = {
  /** The card's `onLongPress`; undefined for a card that stands for nothing, which leaves a hold to the system. */
  onLongPress: (() => void) | undefined
  /** The menu, drawn inside the card while it is held: the system's sheet, opened once the title is read. */
  menu: ReactNode
}
