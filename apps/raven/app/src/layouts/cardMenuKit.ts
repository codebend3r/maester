import type { ReactNode } from 'react'

import type { CardMenuOption } from '@/cardMenu/menuOptions'

/** A card's menu once its title is read: the title over it, and what can be done to the title. */
export type CardMenuViewProps = {
  title: string
  options: readonly CardMenuOption[]
  onClose: () => void
}

/** A card's menu while its title is read, or once the read failed. */
export type ReadingMenuProps = { title: string; isFailed: boolean; onClose: () => void }

/**
 * How each platform shows a card's menu: a list the remote moves through on a TV, the system's
 * action sheet under the thumb. Both draw the same options, built once by the card menu's hooks.
 */
export type CardMenuKit = {
  CardMenuView: (props: CardMenuViewProps) => ReactNode
  ReadingMenu: (props: ReadingMenuProps) => ReactNode
  /** Whether the menu offers Download, as the downloads kit of the same kind does (`CAN_DOWNLOAD`). */
  canDownload: boolean
}
