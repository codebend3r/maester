import type { LibraryIconName } from '@raven/core'
import type { IconName } from '@raven/ui/iconDrawings'
import type { ReactNode } from 'react'

import type { Picture } from '@/queries/cards'

/** One of a library's buttons on its card, as the web's library actions draw it: an icon and its words. */
export type LibraryCardAction = {
  key: string
  text: string
  icon: IconName
  /** What a screen reader calls it, since every card has the same buttons: "Quick scan Films". */
  name: string
  isDisabled: boolean
  onPress: () => void
}

export type LibraryCardProps = {
  /** Where the card sits on its screen, unique there, for a TV to take the focus back to it. */
  place: string
  name: string
  icon: LibraryIconName
  /** Its type and counts: "Movies · 1,204 videos · 3 not matched". */
  line: string
  /** Its newest video's picture, faded in at the card's right; null for none. */
  picture: Picture | null
  /** The first card, which a TV's remote opens the page on. */
  isFirst: boolean
  /** Whether the card shows what it folds away: its status lines and its buttons. */
  isOpen: boolean
  /** What opens or folds the card, and its name aloud; null for a card that folds nothing away. */
  toggle: LibraryCardToggle | null
  onOpen: () => void
  /** How its work stands and why a press failed, a line each; an alert is read out at once. */
  lines: readonly LibraryCardLine[]
  actions: readonly LibraryCardAction[]
}

/** The chevron at a card's right, the web's: "Show more of Films" while folded, "Show less of Films" while open. */
type LibraryCardToggle = { name: string; onPress: () => void }

/** A line of words on an open card: a status, or why something failed. */
export type LibraryCardLine = { key: string; text: string; isAlert: boolean }

export type LibrariesPageProps = {
  title: string
  /** How many there are and how many videos they hold; null before any. */
  line: string | null
  /** Why no card shows: none yet, or what the server said. */
  notice: string | null
  onBack: () => void
  /** The cards, stacked full width. */
  children: ReactNode
}

/** The Libraries page, as the web's: the cards stacked full width, under thumb or remote. */
export type LibrariesKit = {
  LibrariesPage: (props: LibrariesPageProps) => ReactNode
  LibraryCard: (props: LibraryCardProps) => ReactNode
}
