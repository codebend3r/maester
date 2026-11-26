import { MUSIC_SORTS, MUSIC_SORT_LABELS, type MusicSort } from '@raven/core'

import { HOME_COPY, LIBRARY_PAGE_COPY } from '@/copy/screens'
import { COVER_SIZES, type CoverSize, RECENT_SORTS, type RecentSort } from '@/prefs'

type RecentChoice = { key: RecentSort; label: string }

/** The two orders of Home's albums, as its control offers them. */
export const HOME_RECENT_CHOICES = [
  { key: RECENT_SORTS.release, label: HOME_COPY.sorts.release },
  { key: RECENT_SORTS.added, label: HOME_COPY.sorts.added },
] as const satisfies readonly RecentChoice[]

/** What Home's albums section is called under each order. */
export const HOME_RECENT_TITLES = {
  [RECENT_SORTS.added]: LIBRARY_PAGE_COPY.recent,
  [RECENT_SORTS.release]: HOME_COPY.latestReleases,
} as const satisfies Record<RecentSort, string>

/** One option of a sheet of choices: what it sets, and its word. */
type ChoiceOption<Value extends string> = { value: Value; label: string }

/** raven's music sorts, in raven's order and in raven's words. */
export const MUSIC_SORT_OPTIONS: readonly ChoiceOption<MusicSort>[] = Object.values(
  MUSIC_SORTS,
).map((sort) => ({ value: sort, label: MUSIC_SORT_LABELS[sort] }))

/** The five cover sizes, smallest first, each in its word. */
export const COVER_SIZE_OPTIONS: readonly ChoiceOption<CoverSize>[] = Object.values(
  COVER_SIZES,
).map((size) => ({ value: size, label: LIBRARY_PAGE_COPY.coverSizes[size] }))
