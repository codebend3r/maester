import {
  LIBRARY_KINDS,
  LIBRARY_VIEWS,
  type LibraryKind,
  type LibrarySettings,
  type LibraryView,
  MEDIA_GROUPINGS,
  MEDIA_SORTS,
  type MediaGroupBy,
  type MatchItemType,
  type MediaSort,
} from '@/contract'

/** What a type of library can do: the one place each rule about Movies, TV shows and Other lives. */
export type KindRules = {
  /** What its files are matched to on TMDB; null for a library that is never matched. */
  matches: MatchItemType | null
  /** The orders it can list its videos in. */
  sorts: readonly MediaSort[]
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
const MATCHED_SORTS: readonly MediaSort[] = ['year-new', 'year-old', 'rating-high', 'rating-low']

/** Sorts that only mean something per file, which a TV library's show cards cannot use. */
const FILE_SORTS: readonly MediaSort[] = [
  'largest',
  'smallest',
  'bitrate-high',
  'bitrate-low',
  'resolution-high',
  'resolution-low',
]

const without = <T>({ all, left }: { all: readonly T[]; left: readonly T[] }): T[] =>
  all.filter((item) => !left.includes(item))

export const KIND_RULES = {
  /** A Movies library starts grouped into matched and not. */
  movies: {
    matches: 'movie',
    sorts: MEDIA_SORTS,
    views: LIBRARY_VIEWS,
    groupings: MEDIA_GROUPINGS,
    view: 'grouped',
    groupBy: 'match',
  },
  /**
   * A TV library lays its shows out as posters, already split into matched
   * and not, so it has no grouped view, and its cards are shows, so no
   * per-file sort.
   */
  shows: {
    matches: 'show',
    sorts: without({ all: MEDIA_SORTS, left: FILE_SORTS }),
    views: without({ all: LIBRARY_VIEWS, left: ['grouped'] }),
    groupings: MEDIA_GROUPINGS,
    view: 'grid',
    groupBy: 'resolution',
  },
  /** An Other library is never matched, so it has no years, scores or match to sort or group by. */
  other: {
    matches: null,
    sorts: without({ all: MEDIA_SORTS, left: MATCHED_SORTS }),
    views: LIBRARY_VIEWS,
    groupings: without({ all: MEDIA_GROUPINGS, left: ['match'] }),
    view: 'grid',
    groupBy: 'resolution',
  },
} as const satisfies Record<LibraryKind, KindRules>

/** The types of library that are matched against TMDB. */
export type MatchedKind = {
  [K in LibraryKind]: (typeof KIND_RULES)[K]['matches'] extends null ? never : K
}[LibraryKind]

export const isMatchedKind = (kind: LibraryKind): kind is MatchedKind =>
  KIND_RULES[kind].matches !== null

export const MATCHED_KINDS: readonly MatchedKind[] = LIBRARY_KINDS.filter(isMatchedKind)

/** What a matched library's files are matched to: a Movies library's to movies, a TV library's to shows. */
export const matchedItemType = <K extends MatchedKind>(
  kind: K,
): (typeof KIND_RULES)[K]['matches'] => KIND_RULES[kind].matches

export const sortsFor = (kind: LibraryKind): readonly MediaSort[] => KIND_RULES[kind].sorts

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
    sort: rules.sorts.includes(settings.sort) ? settings.sort : DEFAULT_LIBRARY_SETTINGS.sort,
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
