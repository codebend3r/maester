import type { LibraryKind } from '@raven/core'
import type { IconName } from '@/components/Icon/Icon'

/** What each type of library is called, and the icon it wears in the side menu. */
export const KINDS: Record<LibraryKind, { label: string; icon: IconName }> = {
  movies: { label: 'Movies', icon: 'film' },
  shows: { label: 'TV shows', icon: 'tv' },
  other: { label: 'Other', icon: 'video' },
}
