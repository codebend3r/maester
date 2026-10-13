import type { LibraryIconName, LibraryKind, LibrarySettings } from '@raven/core'

/**
 * How each type of library looks: what it is called and the icon it wears
 * until the library picks another. What each type can do, posters for a
 * library of movies included, is `KIND_RULES` in `@raven/core`.
 */
export const KINDS: Record<LibraryKind, { label: string; icon: LibraryIconName }> = {
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

/** What each icon stands for, as Edit library names it. */
export const LIBRARY_ICON_LABELS: Record<LibraryIconName, string> = {
  film: 'Movies',
  tv: 'TV shows',
  filmSpark: 'Anime movies',
  tvSpark: 'Anime shows',
  filmHeart: 'Family movies',
  tvHeart: 'Family TV shows',
  globe: 'Documentary movies',
  tvGlobe: 'Documentary shows',
  fourK: '4K',
  musicVideo: 'Music videos',
  youtube: 'YouTube',
  video: 'Home videos',
  standUp: 'Stand-up comedy',
  gamepad: 'Gaming',
  trophy: 'Sporting events',
  octagon: 'UFC',
  basketball: 'Basketball',
  soccer: 'Soccer',
  americanFootball: 'American football',
  headphones: 'Audio',
  music: 'Music',
  disc: 'Lossless music',
  podcast: 'Podcasts',
  audiobook: 'Audiobooks',
}

/** The icon a library wears: the one it picked, else its type's. */
export const libraryIconOf = (settings: Pick<LibrarySettings, 'icon' | 'kind'>): LibraryIconName =>
  settings.icon ?? KINDS[settings.kind].icon

/**
 * What picking `icon` stores, the inverse of `libraryIconOf`: the type's own
 * is kept as none picked, so it goes on changing with the type.
 */
export const pickedIcon = ({
  kind,
  icon,
}: {
  kind: LibraryKind
  icon: LibraryIconName
}): LibrarySettings['icon'] => (icon === KINDS[kind].icon ? null : icon)
