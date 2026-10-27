import { type Infer, oneOf } from '@/schema'

export const SORT_DIRECTIONS = { ascending: 'ascending', descending: 'descending' } as const

export type SortDirection = (typeof SORT_DIRECTIONS)[keyof typeof SORT_DIRECTIONS]

/** Every field a library can be sorted on, in the order a menu offers them. */
export const SORT_FIELD_NAMES = {
  title: 'title',
  added: 'added',
  changed: 'changed',
  size: 'size',
  bitrate: 'bitrate',
  resolution: 'resolution',
  release: 'release',
  rating: 'rating',
  random: 'random',
} as const

export const isSortFieldName = oneOf(Object.values(SORT_FIELD_NAMES))

export type SortFieldName = Infer<typeof isSortFieldName>

/** Every sort a listing can be in; `SORT_FIELDS` files each one under its field. */
export const MEDIA_SORTS = {
  title: 'title',
  titleDesc: 'title-desc',
  oldest: 'oldest',
  added: 'added',
  changedOld: 'changed-old',
  changed: 'changed',
  smallest: 'smallest',
  largest: 'largest',
  bitrateLow: 'bitrate-low',
  bitrateHigh: 'bitrate-high',
  resolutionLow: 'resolution-low',
  resolutionHigh: 'resolution-high',
  yearOld: 'year-old',
  yearNew: 'year-new',
  ratingLow: 'rating-low',
  ratingHigh: 'rating-high',
  random: 'random',
} as const

export const isMediaSort = oneOf(Object.values(MEDIA_SORTS))

export type MediaSort = Infer<typeof isMediaSort>

/** A field that runs either way, or one with the one sort. */
export const SORT_FIELD_TYPES = { directed: 'directed', undirected: 'undirected' } as const

/**
 * What a listing is sorted on, each field with its sorts: one for each way a
 * field runs and the way it starts, or the one sort of a field with no way
 * to it. Ascending runs A to Z, oldest, smallest or lowest first; a field
 * starts the way it is most often wanted, newest or biggest first but for
 * titles. `changed` puts the files last found, renamed, moved or replaced
 * first. Resolution ranks by pixel count. `random` shuffles by a seed the
 * client sends, so the order holds across refetches until it deals a new one.
 */
export const SORT_FIELDS = {
  title: {
    type: SORT_FIELD_TYPES.directed,
    ascending: MEDIA_SORTS.title,
    descending: MEDIA_SORTS.titleDesc,
    start: SORT_DIRECTIONS.ascending,
  },
  added: {
    type: SORT_FIELD_TYPES.directed,
    ascending: MEDIA_SORTS.oldest,
    descending: MEDIA_SORTS.added,
    start: SORT_DIRECTIONS.descending,
  },
  changed: {
    type: SORT_FIELD_TYPES.directed,
    ascending: MEDIA_SORTS.changedOld,
    descending: MEDIA_SORTS.changed,
    start: SORT_DIRECTIONS.descending,
  },
  size: {
    type: SORT_FIELD_TYPES.directed,
    ascending: MEDIA_SORTS.smallest,
    descending: MEDIA_SORTS.largest,
    start: SORT_DIRECTIONS.descending,
  },
  bitrate: {
    type: SORT_FIELD_TYPES.directed,
    ascending: MEDIA_SORTS.bitrateLow,
    descending: MEDIA_SORTS.bitrateHigh,
    start: SORT_DIRECTIONS.descending,
  },
  resolution: {
    type: SORT_FIELD_TYPES.directed,
    ascending: MEDIA_SORTS.resolutionLow,
    descending: MEDIA_SORTS.resolutionHigh,
    start: SORT_DIRECTIONS.descending,
  },
  release: {
    type: SORT_FIELD_TYPES.directed,
    ascending: MEDIA_SORTS.yearOld,
    descending: MEDIA_SORTS.yearNew,
    start: SORT_DIRECTIONS.descending,
  },
  rating: {
    type: SORT_FIELD_TYPES.directed,
    ascending: MEDIA_SORTS.ratingLow,
    descending: MEDIA_SORTS.ratingHigh,
    start: SORT_DIRECTIONS.descending,
  },
  random: { type: SORT_FIELD_TYPES.undirected, sort: MEDIA_SORTS.random },
} as const satisfies Record<
  SortFieldName,
  | {
      type: typeof SORT_FIELD_TYPES.directed
      ascending: MediaSort
      descending: MediaSort
      start: SortDirection
    }
  | { type: typeof SORT_FIELD_TYPES.undirected; sort: MediaSort }
>

type SortFieldRule = (typeof SORT_FIELDS)[SortFieldName]

/** A field's sorts: one for each way it runs, or the one of a field with no way to it. */
export const fieldSorts = (name: SortFieldName): MediaSort[] => {
  const field: SortFieldRule = SORT_FIELDS[name]
  return field.type === SORT_FIELD_TYPES.directed
    ? [field.ascending, field.descending]
    : [field.sort]
}
