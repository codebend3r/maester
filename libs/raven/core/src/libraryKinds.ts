import { type CandidateTier, TIER_SETS, type TierSet } from '@/candidateTiers'
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
  /** The search results it prefers, tier by tier: a key of `TIER_SETS`. */
  prefer: TierSet
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
  prefer: 'any',
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
  prefer: 'any',
  fields: without({ all: isSortFieldName.values, left: FILE_FIELDS }),
  views: without({ all: LIBRARY_VIEWS, left: ['grouped'] }),
  groupings: MEDIA_GROUPINGS,
  view: 'grid',
  groupBy: 'resolution',
} as const satisfies KindRules

/** A library that is never matched has no years, scores or match to sort or group by. */
const UNMATCHED_RULES = {
  matches: null,
  prefer: 'any',
  fields: without({ all: isSortFieldName.values, left: MATCHED_FIELDS }),
  views: LIBRARY_VIEWS,
  groupings: without({ all: MEDIA_GROUPINGS, left: ['match'] }),
  view: 'grid',
  groupBy: 'resolution',
} as const satisfies KindRules

/**
 * Anime and family films and shows are matched on TMDB like any movie or
 * show, and documentaries as movies, as Radarr files them, each preferring
 * the results of its own kind. Sporting events are matched as movies too,
 * as TMDB lists events like UFC cards. YouTube videos are not there to
 * match, so they are read like Other.
 */
export const KIND_RULES = {
  movies: MOVIE_RULES,
  shows: SHOW_RULES,
  animeMovies: { ...MOVIE_RULES, prefer: 'anime' },
  animeShows: { ...SHOW_RULES, prefer: 'anime' },
  familyMovies: { ...MOVIE_RULES, prefer: 'family' },
  familyShows: { ...SHOW_RULES, prefer: 'family' },
  documentaries: { ...MOVIE_RULES, prefer: 'documentary' },
  sports: MOVIE_RULES,
  youtube: UNMATCHED_RULES,
  other: UNMATCHED_RULES,
} as const satisfies Record<LibraryKind, KindRules>

/**
 * What a library's files are matched to on TMDB: movies for a Movies, Anime
 * movies, Family movies, Documentaries or Sporting events library, shows for a TV, Anime or
 * Family TV shows one, and null for a type that is never matched. Two types
 * with the same answer read their files the same way.
 */
export const matchTypeFor = (kind: LibraryKind): MatchItemType | null => KIND_RULES[kind].matches

/** The tiers a library of `kind` searches TMDB's results in, in order. */
export const tiersFor = (kind: LibraryKind): readonly CandidateTier[] =>
  TIER_SETS[KIND_RULES[kind].prefer]

/** The results a library of `kind` prefers most, which Fix match lists first. */
export const firstTierFor = (kind: LibraryKind): CandidateTier =>
  TIER_SETS[KIND_RULES[kind].prefer][0]

/**
 * Whether two types of library match their files alike: to the same type of
 * TMDB item, preferring the same results. A change between two that do not
 * matches every file again.
 */
export const matchesAlike = ({
  before,
  after,
}: {
  before: LibraryKind
  after: LibraryKind
}): boolean =>
  matchTypeFor(before) === matchTypeFor(after) &&
  KIND_RULES[before].prefer === KIND_RULES[after].prefer

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
  icon: null,
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
