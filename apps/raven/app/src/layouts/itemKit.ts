import type { ReactNode } from 'react'
import type { AccessibilityRole, AccessibilityState } from 'react-native'

import { BUTTON_TONES, type ButtonTone } from '@/layouts/formKit'

import type { ShelfCard } from '@/queries/cards'
import type { EpisodeRow, ItemHero, ItemPage } from '@/queries/itemPage'
import type { RouteTarget } from '@/routes'

/** How far a mark is on, as React Native says it to a screen reader: on, off, or `mixed`. */
export type CheckState = NonNullable<AccessibilityState['checked']>

/** What an action on an item's page is: Play, or a mark the viewer turns on and off. */
export const ITEM_ACTIONS = { play: 'play', toggle: 'toggle' } as const

export type ItemAction =
  | { kind: typeof ITEM_ACTIONS.play; key: string; label: string; onPress: () => void }
  | {
      kind: typeof ITEM_ACTIONS.toggle
      key: string
      label: string
      /** Whether the mark is on; `mixed` for a show or season only partly watched. */
      isOn: CheckState
      onPress: () => void
    }

export type ItemLayoutProps = {
  page: ItemPage
  /** Play, when the page knows what it starts, then the marks. */
  actions: ItemAction[]
  /**
   * Whether what Play starts is still being read, as a show's next episode is. A TV draws no
   * action and no row until it is known, so Play is there to take the opening focus.
   */
  isPlayPending: boolean
  onOpen: (target: RouteTarget) => void
  onBack: () => void
}

export type ItemNoticeProps = { notice: string; onBack: () => void }

/** An item's page, which each platform lays out and drives its own way. */
export type ItemKit = {
  ItemLayout: (props: ItemLayoutProps) => ReactNode
  /** The page's frame with only a line in it: while the item is read, or when it is not there. */
  ItemNotice: (props: ItemNoticeProps) => ReactNode
}

export const ITEM_HEADINGS = {
  file: 'File',
  versions: 'Versions',
  seasons: 'Seasons',
  episodes: 'Episodes',
} as const

/** What a version's Play is called aloud: "Play Busboys (2026).mkv". */
export const playLabelOf = (fileName: string): string => `Play ${fileName}`

/** What marks an episode watched on its row, and what it is called aloud. */
export const WATCHED_MARK = '✓ Watched'
const WATCHED_WORD = 'Watched'

/** An episode row as it is read out: "E2 · Half Loop, 18 Feb 2022 · 55m, Watched". */
export const episodeLabelOf = (episode: EpisodeRow): string =>
  [episode.title, episode.line, episode.isWatched ? WATCHED_WORD : null]
    .filter((part): part is string => part !== null)
    .join(', ')

/** What sits before a mark's label while it is on. */
const ON_MARK = '✓ '

/**
 * How an action's button looks and is read out: Play filled as the one action the page is for,
 * a mark as a checkbox in the quiet tone, ticked while it is on.
 */
export const actionLookOf = (
  action: ItemAction,
): {
  tone: ButtonTone
  role: AccessibilityRole
  state: AccessibilityState | undefined
  text: string
} => {
  switch (action.kind) {
    case ITEM_ACTIONS.play:
      return { tone: BUTTON_TONES.primary, role: 'button', state: undefined, text: action.label }
    case ITEM_ACTIONS.toggle:
      return {
        tone: BUTTON_TONES.quiet,
        role: 'checkbox',
        state: { checked: action.isOn },
        text: action.isOn === true ? `${ON_MARK}${action.label}` : action.label,
      }
    default: {
      const unknown: never = action
      return unknown
    }
  }
}

/** A line of facts, as the web's dotted list reads. */
export const dotted = (parts: readonly string[]): string => parts.join(' · ')

/** The heading's facts on one line, its content rating last. */
export const heroFactsOf = (hero: ItemHero): string =>
  dotted([...hero.facts, ...(hero.rating === null ? [] : [hero.rating])])

/** The heading's picture as a card draws it: its poster or still, with no progress along it. */
export const heroPictureOf = (
  hero: ItemHero,
): Pick<ShelfCard, 'title' | 'shape' | 'picture' | 'progress'> => ({
  title: hero.title,
  shape: hero.poster.shape,
  picture: hero.poster.picture,
  progress: 0,
})
