import type { LibraryKind } from '@raven/core'
import type { IconName } from '@/components/Icon/Icon'

/**
 * How each type of library looks: what it is called, the icon it wears in
 * the side menu, and whether its videos show as posters. What each type can
 * do is `KIND_RULES` in `@raven/core`.
 */
export const KINDS: Record<LibraryKind, { label: string; icon: IconName; posters: boolean }> = {
  movies: { label: 'Movies', icon: 'film', posters: true },
  shows: { label: 'TV shows', icon: 'tv', posters: false },
  other: { label: 'Other', icon: 'video', posters: false },
}
