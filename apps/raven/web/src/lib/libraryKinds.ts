import type { LibraryKind } from '@raven/core'

/** What each type of library is called, in the order the dialog offers them. */
export const KIND_LABELS: Record<LibraryKind, string> = {
  movies: 'Movies',
  shows: 'TV shows',
  other: 'Other',
}
