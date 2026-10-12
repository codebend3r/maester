import type { LibraryKind } from '@raven/core'
import type { IconName } from '@/components/Icon/Icon'

/**
 * How each type of library looks: what it is called and the icon it wears in
 * the side menu. What each type can do, posters for a library of movies
 * included, is `KIND_RULES` in `@raven/core`.
 */
export const KINDS: Record<LibraryKind, { label: string; icon: IconName }> = {
  movies: { label: 'Movies', icon: 'film' },
  shows: { label: 'TV shows', icon: 'tv' },
  animeMovies: { label: 'Anime movies', icon: 'filmSpark' },
  animeShows: { label: 'Anime shows', icon: 'tvSpark' },
  familyMovies: { label: 'Family movies', icon: 'filmHeart' },
  familyShows: { label: 'Family TV shows', icon: 'tvHeart' },
  documentaries: { label: 'Documentaries', icon: 'globe' },
  sports: { label: 'Sporting events', icon: 'trophy' },
  youtube: { label: 'YouTube videos', icon: 'youtube' },
  other: { label: 'Other', icon: 'video' },
}
