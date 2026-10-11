import type { LibraryKind } from '@raven/core'
import type { IconName } from '@/components/Icon/Icon'

/** What each type of library is called, in the order the dialog offers them. */
export const KIND_LABELS: Record<LibraryKind, string> = {
  movies: 'Movies',
  shows: 'TV shows',
  other: 'Other',
}

/** The icon a library of each type wears in the side menu. */
export const KIND_ICONS: Record<LibraryKind, IconName> = {
  movies: 'film',
  shows: 'tv',
  other: 'video',
}
