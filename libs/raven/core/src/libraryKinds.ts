import {
  LIBRARY_KINDS,
  LIBRARY_VIEWS,
  type LibraryKind,
  type LibrarySettings,
  type LibraryView,
  MEDIA_GROUPINGS,
  type MediaGroupBy,
  type MatchItemType,
  type MediaSort,
  type SortFieldName,
  fieldSorts,
  isSortFieldName,
} from '@/contract'
import { sortParts } from '@/sortFields'

/** What a type of library can do: the one place each rule about each type lives. */
export type KindRules = {
  /** What its files are matched to on TMDB; null for a library that is never matched. */
  matches: MatchItemType | null
  /** The fields it can sort its videos on, in the order a menu offers them. */
  fields: readonly SortFieldName[]
  /** The layouts it can show. */
  views: readonly LibraryView[]
  /** What its grouped view can bucket by. */
  groupings: readonly MediaGroupBy[]
  /** The layout a new library starts with, and what one it cannot show falls back to. */
  view: LibraryView
  /** The grouping a new library starts with, and what one it cannot use falls back to. */
  groupBy: MediaGroupBy
}

/** Release years come from names, and scores from TMDB, which only matched libraries read. */
const MATCHED_FIELDS: readonly SortFieldName[] = ['release', 'rating']

/**
 * Fields only a file has, which a TV library's show cards cannot sort on. A
 * show's bitrate is the mean of its files', so shows sort on that.
 */
const FILE_FIELDS: readonly SortFieldName[] = ['size', 'resolution']

const without = <T>({ all, left }: { all: readonly T[]; left: readonly T[] }): T[] =>
  all.filter((item) => !left.includes(item))

/** A library of movies starts grouped into matched and not. */
const MOVIE_RULES = {
  matches: 'movie',
  fields: isSortFieldName.values,
  views: LIBRARY_VIEWS,
  groupings: MEDIA_GROUPINGS,
  view: 'grouped',
  groupBy: 'match',
} as const satisfies KindRules

/**
 * A library of shows lays its shows out as posters, already split into
 * matched and not, so it has no grouped view, and its cards are shows, so
 * no sort on a field only a file has.
 */
const SHOW_RULES = {
  matches: 'show',
  fields: without({ all: isSortFieldName.values, left: FILE_FIELDS }),
  views: without({ all: LIBRARY_VIEWS, left: ['grouped'] }),
  groupings: MEDIA_GROUPINGS,
  view: 'grid',
  groupBy: 'resolution',
} as const satisfies KindRules

/** A library that is never matched has no years, scores or match to sort or group by. */
const UNMATCHED_RULES = {
  matches: null,
  fields: without({ all: isSortFieldName.values, left: MATCHED_FIELDS }),
  views: LIBRARY_VIEWS,
  groupings: without({ all: MEDIA_GROUPINGS, left: ['match'] }),
  view: 'grid',
  groupBy: 'resolution',
} as const satisfies KindRules

/**
 * Anime and family films and shows are matched on TMDB like any movie or
 * show, and documentaries as movies, as Radarr files them. Sporting events
 * and YouTube videos are not there to match, so they are read like Other.
 */
export const KIND_RULES = {
  movies: MOVIE_RULES,
  shows: SHOW_RULES,
  animeMovies: MOVIE_RULES,
  animeShows: SHOW_RULES,
  familyMovies: MOVIE_RULES,
  familyShows: SHOW_RULES,
  documentaries: MOVIE_RULES,
  sports: UNMATCHED_RULES,
  youtube: UNMATCHED_RULES,
  other: UNMATCHED_RULES,
} as const satisfies Record<LibraryKind, KindRules>

/**
 * What a library's files are matched to on TMDB: movies for a Movies, Anime
 * movies, Family movies or Documentaries library, shows for a TV, Anime or
 * Family TV shows one, and null for a type that is never matched. Two types
 * with the same answer read their files the same way.
 */
export const matchTypeFor = (kind: LibraryKind): MatchItemType | null => KIND_RULES[kind].matches

/** The types of library that are matched against TMDB. */
export const MATCHED_KINDS: readonly LibraryKind[] = LIBRARY_KINDS.filter(
  (kind) => matchTypeFor(kind) != null,
)

/** Whether the library's cards are its shows, with its files no show was found for listed apart. */
export const listsShows = (kind: LibraryKind): boolean => matchTypeFor(kind) === 'show'

/** The fields a library of `kind` can sort on, in the order a menu offers them. */
export const sortFieldsFor = (kind: LibraryKind): readonly SortFieldName[] =>
  KIND_RULES[kind].fields

/** Every sort a library of `kind` can list its videos in: each of its fields, each way. */
export const sortsFor = (kind: LibraryKind): MediaSort[] => sortFieldsFor(kind).flatMap(fieldSorts)

export const viewsFor = (kind: LibraryKind): readonly LibraryView[] => KIND_RULES[kind].views

export const groupingsFor = (kind: LibraryKind): readonly MediaGroupBy[] =>
  KIND_RULES[kind].groupings

/** What a new library starts with, and what a library made before settings existed has. */
export const DEFAULT_LIBRARY_SETTINGS: LibrarySettings = {
  saveProgress: true,
  pinned: true,
  sort: 'title',
  view: 'grid',
  groupBy: 'resolution',
  watchedPercent: 90,
  kind: 'other',
  ratingsSource: 'tmdb',
  autoRefresh: true,
  locked: false,
  folderLayout: 'auto',
}

/**
 * Settings its type can show: a sort, view or grouping the library's type
 * has no use for is swapped for that type's own. Applied wherever settings
 * are stored or read from an address, so nothing downstream checks again.
 */
export const coherentSettings = (settings: LibrarySettings): LibrarySettings => {
  const rules: KindRules = KIND_RULES[settings.kind]
  return {
    ...settings,
    sort: rules.fields.includes(sortParts(settings.sort).field)
      ? settings.sort
      : DEFAULT_LIBRARY_SETTINGS.sort,
    view: rules.views.includes(settings.view) ? settings.view : rules.view,
    groupBy: rules.groupings.includes(settings.groupBy) ? settings.groupBy : rules.groupBy,
  }
}

/** What a new library of `kind` starts with. */
export const defaultLibrarySettings = (kind: LibraryKind): LibrarySettings => ({
  ...DEFAULT_LIBRARY_SETTINGS,
  kind,
  view: KIND_RULES[kind].view,
  groupBy: KIND_RULES[kind].groupBy,
})

/** Settings with the library's type changed, and whatever the new type cannot show swapped for its own. */
export const withLibraryKind = ({
  settings,
  kind,
}: {
  settings: LibrarySettings
  kind: LibraryKind
}): LibrarySettings => coherentSettings({ ...settings, kind })
