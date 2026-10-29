import { type CandidateTier, TIER_SETS, TIER_SET_NAMES, type TierSet } from '@/candidateTiers'
import {
  FOLDER_LAYOUTS,
  ITEM_TYPES,
  LIBRARY_KINDS,
  LIBRARY_VIEWS,
  type LibraryIconName,
  type LibraryKind,
  type LibrarySettings,
  type LibraryView,
  MEDIA_GROUPINGS,
  MEDIA_SORTS,
  type MatchItemType,
  type MediaGroupBy,
  type MediaSort,
  RATING_SOURCES,
  SORT_FIELD_NAMES,
  type SortFieldName,
  fieldSorts,
  isLibraryKind,
  isLibraryView,
  isMediaGroupBy,
  isSortFieldName,
} from '@/contract'
import { MEDIA_EXTENSIONS, MEDIA_TYPES, type MediaType } from '@/media'
import { sortParts } from '@/sortFields'

/** What a type of library can do: the one place each rule about each type lives. */
export type KindRules = {
  /** What its files are: videos, or audio files. */
  media: MediaType
  /** Whether a new library saves the spot each file was left at. */
  saveProgress: boolean
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
const MATCHED_FIELDS: readonly SortFieldName[] = [SORT_FIELD_NAMES.release, SORT_FIELD_NAMES.rating]

/**
 * Fields only a file has, which a TV library's show cards cannot sort on. A
 * show's bitrate is the mean of its files', so shows sort on that.
 */
const FILE_FIELDS: readonly SortFieldName[] = [SORT_FIELD_NAMES.size, SORT_FIELD_NAMES.resolution]

type WithoutProps<T> = { all: readonly T[]; left: readonly T[] }

const without = <T>({ all, left }: WithoutProps<T>): T[] =>
  all.filter((item) => !left.includes(item))

/** A library of movies opens on its posters. */
const MOVIE_RULES = {
  media: MEDIA_TYPES.video,
  saveProgress: true,
  matches: ITEM_TYPES.movie,
  prefer: TIER_SET_NAMES.any,
  fields: isSortFieldName.values,
  views: isLibraryView.values,
  groupings: isMediaGroupBy.values,
  view: LIBRARY_VIEWS.grid,
  groupBy: MEDIA_GROUPINGS.match,
} as const satisfies KindRules

/**
 * A library of shows lays its shows out as posters, already split into
 * matched and not, so it has no grouped view, and its cards are shows, so
 * no sort on a field only a file has.
 */
const SHOW_RULES = {
  media: MEDIA_TYPES.video,
  saveProgress: true,
  matches: ITEM_TYPES.show,
  prefer: TIER_SET_NAMES.any,
  fields: without({ all: isSortFieldName.values, left: FILE_FIELDS }),
  views: without({ all: isLibraryView.values, left: [LIBRARY_VIEWS.grouped] }),
  groupings: isMediaGroupBy.values,
  view: LIBRARY_VIEWS.grid,
  groupBy: MEDIA_GROUPINGS.resolution,
} as const satisfies KindRules

/** A library that is never matched has no years, scores or match to sort or group by. */
const UNMATCHED_RULES = {
  media: MEDIA_TYPES.video,
  saveProgress: true,
  matches: null,
  prefer: TIER_SET_NAMES.any,
  fields: without({ all: isSortFieldName.values, left: MATCHED_FIELDS }),
  views: isLibraryView.values,
  groupings: without({ all: isMediaGroupBy.values, left: [MEDIA_GROUPINGS.match] }),
  view: LIBRARY_VIEWS.grid,
  groupBy: MEDIA_GROUPINGS.resolution,
} as const satisfies KindRules

/**
 * A library of audio files is never matched yet, and has no frame to sort
 * or group by. It starts as a list grouped by the month each file came in.
 */
const AUDIO_RULES = {
  media: MEDIA_TYPES.audio,
  saveProgress: true,
  matches: null,
  prefer: TIER_SET_NAMES.any,
  fields: without({
    all: isSortFieldName.values,
    left: [...MATCHED_FIELDS, SORT_FIELD_NAMES.resolution],
  }),
  views: isLibraryView.values,
  groupings: [MEDIA_GROUPINGS.codec, MEDIA_GROUPINGS.month],
  view: LIBRARY_VIEWS.list,
  groupBy: MEDIA_GROUPINGS.month,
} as const satisfies KindRules

/**
 * Anime and family films and shows are matched on TMDB like any movie or
 * show, and documentaries as movies, as Radarr files them, each preferring
 * the results of its own kind. Sporting events are matched as movies too,
 * as TMDB lists events like UFC cards. YouTube videos are not there to
 * match, so they are read like Other. A song starts from its beginning each
 * time, so music saves no spot; an audiobook does.
 */
export const KIND_RULES = {
  movies: MOVIE_RULES,
  shows: SHOW_RULES,
  animeMovies: { ...MOVIE_RULES, prefer: TIER_SET_NAMES.anime },
  animeShows: { ...SHOW_RULES, prefer: TIER_SET_NAMES.anime },
  familyMovies: { ...MOVIE_RULES, prefer: TIER_SET_NAMES.family },
  familyShows: { ...SHOW_RULES, prefer: TIER_SET_NAMES.family },
  documentaries: { ...MOVIE_RULES, prefer: TIER_SET_NAMES.documentary },
  sports: MOVIE_RULES,
  youtube: UNMATCHED_RULES,
  other: UNMATCHED_RULES,
  music: { ...AUDIO_RULES, saveProgress: false },
  audiobooks: AUDIO_RULES,
} as const satisfies Record<LibraryKind, KindRules>

/**
 * What a library's files are matched to on TMDB, by its type's rules; null
 * for a type that is never matched. Two types with the same answer read
 * their files the same way.
 */
export const matchTypeFor = (kind: LibraryKind): MatchItemType | null => KIND_RULES[kind].matches

/** The tiers a library of `kind` searches TMDB's results in, in order. */
export const tiersFor = (kind: LibraryKind): readonly CandidateTier[] =>
  TIER_SETS[KIND_RULES[kind].prefer]

/** The results a library of `kind` prefers most, which Fix match lists first. */
export const firstTierFor = (kind: LibraryKind): CandidateTier =>
  TIER_SETS[KIND_RULES[kind].prefer][0]

type MatchesAlikeProps = {
  before: LibraryKind
  after: LibraryKind
}

/**
 * Whether two types of library match their files alike: to the same type of
 * TMDB item, preferring the same results. A change between two that do not
 * matches every file again.
 */
export const matchesAlike = ({ before, after }: MatchesAlikeProps): boolean =>
  matchTypeFor(before) === matchTypeFor(after) &&
  KIND_RULES[before].prefer === KIND_RULES[after].prefer

/** The extensions a library of `kind` indexes. */
export const extensionsFor = (kind: LibraryKind): readonly string[] =>
  MEDIA_EXTENSIONS[KIND_RULES[kind].media]

/** The types of library that are matched against TMDB. */
export const MATCHED_KINDS: readonly LibraryKind[] = isLibraryKind.values.filter(
  (kind) => matchTypeFor(kind) != null,
)

/** Whether the library's cards are its shows, with its files no show was found for listed apart. */
export const listsShows = (kind: LibraryKind): boolean => matchTypeFor(kind) === ITEM_TYPES.show

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
  inHero: true,
  sort: MEDIA_SORTS.title,
  view: LIBRARY_VIEWS.grid,
  groupBy: MEDIA_GROUPINGS.resolution,
  watchedPercent: 95,
  kind: LIBRARY_KINDS.other,
  ratingsSource: RATING_SOURCES.metacritic,
  autoRefresh: true,
  locked: false,
  folderLayout: FOLDER_LAYOUTS.auto,
  icon: null,
}

/**
 * Settings its type can show: a sort, view or grouping the library's type
 * has no use for is swapped for that type's own. A locked library is never
 * in the hero, whatever was sent or stored. Applied wherever settings are
 * stored or read from an address, so nothing downstream checks again.
 */
export const coherentSettings = (settings: LibrarySettings): LibrarySettings => {
  const rules: KindRules = KIND_RULES[settings.kind]
  return {
    ...settings,
    inHero: settings.inHero && !settings.locked,
    sort: rules.fields.includes(sortParts(settings.sort).field)
      ? settings.sort
      : DEFAULT_LIBRARY_SETTINGS.sort,
    view: rules.views.includes(settings.view) ? settings.view : rules.view,
    groupBy: rules.groupings.includes(settings.groupBy) ? settings.groupBy : rules.groupBy,
  }
}

/**
 * A library as it opens, on every visit: on its type's own view, the grid
 * for movies and shows, whatever view was last picked. A view picked while
 * it is open holds until it is left.
 */
export const openingSettings = (settings: LibrarySettings): LibrarySettings => ({
  ...settings,
  view: KIND_RULES[settings.kind].view,
})

/**
 * What of a choice of sort, view and grouping a library keeps: all but the
 * view, which holds only while it is open (see `openingSettings`).
 */
export const withoutView = <T extends { view?: LibraryView }>(choice: T): Omit<T, 'view'> => {
  const { view: _view, ...kept } = choice
  return kept
}

/** What a new library of `kind` starts with. */
export const defaultLibrarySettings = (kind: LibraryKind): LibrarySettings => ({
  ...DEFAULT_LIBRARY_SETTINGS,
  kind,
  saveProgress: KIND_RULES[kind].saveProgress,
  view: KIND_RULES[kind].view,
  groupBy: KIND_RULES[kind].groupBy,
})

type WithLibraryKindProps = {
  settings: LibrarySettings
  kind: LibraryKind
}

/** Settings with the library's type changed, and whatever the new type cannot show swapped for its own. */
export const withLibraryKind = ({ settings, kind }: WithLibraryKindProps): LibrarySettings =>
  coherentSettings({ ...settings, kind })

/**
 * How each type of library looks: what it is called and the icon it wears
 * until the library picks another. What each type can do, posters for a
 * library of movies included, is `KIND_RULES` above.
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
  music: { label: 'Music', icon: 'music' },
  audiobooks: { label: 'Audiobooks', icon: 'audiobook' },
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

/** The icon a library wears: the one it picked, else its type's, which changes with the type. */
export const libraryIconOf = (settings: Pick<LibrarySettings, 'icon' | 'kind'>): LibraryIconName =>
  settings.icon ?? KINDS[settings.kind].icon
