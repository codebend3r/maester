import type { ReactNode } from 'react'
import type { AccessibilityState } from 'react-native'

import type { EpisodeRow, ItemPage } from '@/queries/itemPage'
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
  /** Play, then the marks; null while what Play starts is still being read. */
  actions: ItemAction[] | null
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
export const ON_MARK = '✓ '

/** A line of facts, as the web's dotted list reads. */
export const dotted = (parts: readonly string[]): string => parts.join(' · ')
