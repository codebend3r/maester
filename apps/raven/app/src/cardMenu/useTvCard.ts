import type { ReactNode, RefObject } from 'react'

import { useCardMenu } from '@/cardMenu/useCardMenu'
import { focusCardMenu } from '@/layouts/CardMenu.focus'
import { useOpenerFocus, useOpeningFocus } from '@/layouts/focus'
import type { ShelfCard } from '@/queries/cards'

type UseTvCardProps = {
  card: Pick<ShelfCard, 'title' | 'subject'>
  /** The card's place on its screen, unique there. */
  place: string
  /** The shelf the card sits on, for Home's shelves to bring into view as it takes the focus back; none off a shelf. */
  shelf?: string | null
  view: RefObject<unknown>
  onPress: () => void
}

type TvCard = {
  /** Whether the remote is on the card, which the card draws its ring and growth from. */
  isFocused: boolean
  /** The menu of marks, drawn inside the card while it is open. */
  menu: ReactNode
  /** The card's `Pressable` handlers. */
  onFocus: () => void
  onBlur: () => void
  onPress: () => void
}

/**
 * Everything a TV card does with the remote, whatever it looks like: taking the focus spends the
 * screen's opening focus, a press remembers the card as the opener before it opens, the card
 * takes the focus back when the screen returns, and a held select opens its menu of marks, whose
 * hold's own tail never counts as a press.
 */
export const useTvCard = ({ card, place, shelf = null, view, onPress }: UseTvCardProps): TvCard => {
  const { remember } = useOpenerFocus({ place, shelf, view })
  const { settle } = useOpeningFocus()
  const menu = useCardMenu({ card, kit: focusCardMenu })
  return {
    isFocused: menu.isFocused,
    menu: menu.menu,
    onFocus: () => {
      menu.onFocus()
      settle()
    },
    onBlur: menu.onBlur,
    onPress: menu.guard(() => {
      remember()
      onPress()
    }),
  }
}
