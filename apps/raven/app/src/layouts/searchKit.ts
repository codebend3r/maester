import type { Search } from '@raven/ui/headless'
import type { ReactNode } from 'react'

export type SearchFieldProps = {
  /** The box's state, from headless `useSearch`, so it searches only once typing pauses. */
  search: Search
  /** What it searches, shown while it is empty and said aloud: "Search Films". */
  label: string
  /** Asks the remote's focus for the field as it mounts, on a TV. */
  isPreferred?: boolean
  /** Hears each time the field gets the focus. */
  onFocused?: () => void
}

export type SearchLayoutProps = {
  title: string
  /** The field's label: "Search every library". */
  label: string
  search: Search
  /** A line in place of the results: while they are read, when they fail, or when none match. */
  notice: string | null
  onBack: () => void
  /** The results, as shelves. */
  children: ReactNode
}

/** A search box and the search screen, which each platform lays out and drives its own way. */
export type SearchKit = {
  SearchField: (props: SearchFieldProps) => ReactNode
  SearchLayout: (props: SearchLayoutProps) => ReactNode
}

/** The button that empties a search box, as it is called aloud, and what it shows. */
export const CLEAR_SEARCH = { label: 'Clear search', text: '×' } as const
