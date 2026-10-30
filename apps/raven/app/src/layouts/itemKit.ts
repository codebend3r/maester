import type { IconName } from '@raven/ui/iconDrawings'
import type { ReactNode } from 'react'
import type { AccessibilityRole, AccessibilityState } from 'react-native'

import { BUTTON_TONES, type ButtonTone } from '@/layouts/formKit'

import type { ShelfCard } from '@/queries/cards'
import type { EpisodeRow, ItemHero, ItemPage } from '@/queries/itemPage'
import type { RouteTarget } from '@/routes'

/** How far a mark is on, as React Native says it to a screen reader: on, off, or `mixed`. */
export type CheckState = NonNullable<AccessibilityState['checked']>

/**
 * What an action on an item's page is: Play, a mark the viewer turns on and off, or a link to
 * another page (an episode's show and season).
 */
export const ITEM_ACTIONS = {
  play: 'play',
  option: 'option',
  toggle: 'toggle',
  link: 'link',
} as const

/** What every action shares: its icon, what it is called aloud, and the few words beside the icon, if any. */
type ActionFace = {
  key: string
  icon: IconName
  label: string
  /** What stands beside the icon: a time, a code, a name; null for the icon alone. */
  text: string | null
  onPress: () => void
}

export type ItemAction =
  | (ActionFace & { kind: typeof ITEM_ACTIONS.play })
  /** Another way to play, beside the one the page is for: Play from the beginning. */
  | (ActionFace & { kind: typeof ITEM_ACTIONS.option })
  | (ActionFace & {
      kind: typeof ITEM_ACTIONS.toggle
      /** Whether the mark is on; `mixed` for a show or season only partly watched. */
      isOn: CheckState
    })
  | (ActionFace & { kind: typeof ITEM_ACTIONS.link })

export type ItemLayoutProps = {
  page: ItemPage
  /** Play, when the page knows what it starts, an episode's Next, then the marks. */
  actions: ItemAction[]
  /** The way up from an episode to its show and its season, on a row of their own. */
  links: ItemAction[]
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

/**
 * How an action's button looks and is read out: Play filled as the one action the page is for,
 * a mark as a checkbox in the quiet tone, filled while it is on, a link in the ghost tone. Each
 * shows its icon, with its few words beside it where it has any.
 */
export const actionLookOf = (
  action: ItemAction,
): {
  tone: ButtonTone
  role: AccessibilityRole
  state: AccessibilityState | undefined
  icon: IconName
  text: string | null
} => {
  const { icon, text } = action
  switch (action.kind) {
    case ITEM_ACTIONS.play:
      return { tone: BUTTON_TONES.primary, role: 'button', state: undefined, icon, text }
    case ITEM_ACTIONS.option:
      return { tone: BUTTON_TONES.quiet, role: 'button', state: undefined, icon, text }
    case ITEM_ACTIONS.toggle:
      return {
        tone: action.isOn === true ? BUTTON_TONES.primary : BUTTON_TONES.quiet,
        role: 'checkbox',
        state: { checked: action.isOn },
        icon,
        text,
      }
    case ITEM_ACTIONS.link:
      return { tone: BUTTON_TONES.ghost, role: 'link', state: undefined, icon, text }
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
