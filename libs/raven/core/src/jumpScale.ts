import {
  type MediaItem,
  type MediaSort,
  RATING_SOURCES,
  type RatingSource,
  SORT_DIRECTIONS,
  SORT_FIELD_NAMES,
  type ShowEntry,
  type SortFieldName,
} from '@/contract'
import { mediaEntryKey, showEntryKey } from '@/entryKeys'
import { pickScore } from '@/items'
import { LETTERS, type Letter, SPECIAL_LETTERS, mediaLetter, showLetter } from '@/letters'
import { RESOLUTIONS, type Resolution, resolutionLabel } from '@/media'
import { sortParts } from '@/sortFields'

/** One step of the jump strip. */
type JumpMark = {
  key: string
  /** What the strip shows: `A`, `70`, `4K`, `2020`, `Oct`. */
  label: string
  /** What it is called aloud: `70 to 75 Mb/s`, `October 2026`. */
  name: string
}

type JumpField = Exclude<SortFieldName, 'random'>

/**
 * The strip for a listing in one order: what it jumps by, the unit its
 * numbers count in, its marks in the order the listing runs, and the
 * entries under each, by `entryKey`. A mark no entry falls under is kept,
 * so the strip keeps its shape, but cannot be pressed.
 */
export type JumpScale = {
  field: JumpField
  unit: string | null
  marks: JumpMark[]
  entries: ReadonlyMap<string, ReadonlySet<string>>
}

/** A listing's entry as the strip reads it: the values each sort goes by. */
type Entry = {
  key: string
  letter: Letter
  bitrate: number | null
  size: number | null
  resolution: Resolution | null
  year: number | null
  /** Out of 10, as every source is kept. */
  score: number | null
  added: string | null
  changed: string | null
}

const fromMedia = ({ media, source }: { media: MediaItem; source: RatingSource }): Entry => ({
  key: mediaEntryKey(media),
  letter: mediaLetter(media),
  bitrate: media.bitrate,
  size: media.size,
  resolution: resolutionLabel(media),
  year: media.item?.year ?? media.year,
  score: media.item ? (pickScore({ ratings: media.item.ratings, source })?.value ?? null) : null,
  added: media.addedAt,
  changed: media.changedAt,
})

const fromShow = ({ entry, source }: { entry: ShowEntry; source: RatingSource }): Entry => ({
  key: showEntryKey(entry.show),
  letter: showLetter(entry.show),
  bitrate: entry.bitrate,
  size: null,
  resolution: null,
  year: entry.show.year,
  score: pickScore({ ratings: entry.show.ratings, source })?.value ?? null,
  added: entry.addedAt,
  changed: null,
})

const UNKNOWN: JumpMark = { key: '?', label: '?', name: 'Not known yet' }

/** The least and the most of the values a strip is laid along. */
type Range = { low: number; high: number }

/** A range cut into marks, each an index: the one a value falls under, and what each shows. */
type Cut = {
  of: (value: number) => number
  face: (index: number) => Omit<JumpMark, 'key'>
}

/**
 * How the strip lays out one field: the unit its numbers count in, the
 * number an entry has on it (null for none yet), and how the range of
 * those numbers is cut into marks. A `full` range lays out every mark
 * whatever the entries hold, as the letters and the resolutions do.
 */
type Ruler = {
  unit: string | null
  value: (entry: Entry) => number | null
  full?: Range
  cut: (range: Range) => Cut
}

/**
 * The step a number scale climbs by: one, two or five times a power of
 * ten, the smallest that cuts `span` into at most `most` steps.
 */
export const niceStep = ({ span, most }: { span: number; most: number }): number => {
  if (span <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(span / most))
  return [1, 2, 5, 10].map((n) => n * power).find((step) => span / step <= most) ?? 10 * power
}

/** How many marks a number scale reaches for at most, so the strip fits any screen. */
const MOST_STEPS = 16

/** Round steps of `unit`, by `step` or else by what fits the strip. */
const steps = ({
  unit,
  value,
  step: fixed,
}: {
  unit: string
  value: (entry: Entry) => number | null
  step: number | null
}): Ruler => ({
  unit,
  value,
  cut: ({ low, high }) => {
    const step = fixed ?? niceStep({ span: high - low, most: MOST_STEPS })
    // As many decimals as the step needs, rounded then read back, so 3 is `3` and 3.5 is `3.5`.
    const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))
    const show = (index: number) => String(Number((index * step).toFixed(decimals)))
    return {
      of: (number) => Math.floor(number / step),
      face: (index) => ({
        label: show(index),
        name: `${show(index)} to ${show(index + 1)} ${unit}`,
      }),
    }
  },
})

/** Every one of `list` in its order, whatever the entries hold; an entry's value is its place in it. */
const listed = <T extends string>({
  list,
  item,
  face,
}: {
  list: readonly T[]
  item: (entry: Entry) => T | null
  face: (each: T) => Omit<JumpMark, 'key'>
}): Ruler => ({
  unit: null,
  value: (entry) => {
    const each = item(entry)
    return each == null ? null : list.indexOf(each)
  },
  full: { low: 0, high: list.length - 1 },
  cut: () => ({ of: (index) => index, face: (index) => face(list[index]) }),
})

// In UTC, as the grouped view reads months, so the strip and the buckets agree.
const MONTH_LABEL = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' })
const MONTH_NAME = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/** A year's worth of days and a little over, the most a scale of months spans. */
const MONTHS_SPAN_MS = 400 * 24 * 60 * 60 * 1000

/** Months counted from year 0, so two months a year apart are 12 apart. */
const BY_MONTH: Cut = {
  of: (time) => {
    const date = new Date(time)
    return date.getUTCFullYear() * 12 + date.getUTCMonth()
  },
  face: (index) => {
    const month = Date.UTC(Math.floor(index / 12), index % 12, 1)
    return { label: MONTH_LABEL.format(month), name: MONTH_NAME.format(month) }
  },
}

const yearFace = (year: number) => ({ label: String(year), name: String(year) })

const BY_YEAR: Cut = { of: (time) => new Date(time).getUTCFullYear(), face: yearFace }

/** When entries came or changed: months across a year or so, else years. */
const dates = (at: (entry: Entry) => string | null): Ruler => ({
  unit: null,
  value: (entry) => {
    const time = Date.parse(at(entry) ?? '')
    return Number.isNaN(time) ? null : time
  },
  cut: ({ low, high }) => (high - low <= MONTHS_SPAN_MS ? BY_MONTH : BY_YEAR),
})

/** Scores in whole points out of 10, a perfect 10 its own, written as the library's source writes them. */
const scores = (source: RatingSource): Ruler => {
  const isOutOfTen = source === RATING_SOURCES.imdb
  const unit = isOutOfTen || source === RATING_SOURCES.metacritic ? null : '%'
  const percent = unit ?? ''
  return {
    unit,
    value: (entry) => entry.score,
    cut: () => ({
      of: (score) => Math.min(Math.floor(score), 10),
      face: (point) => {
        const [from, to] = isOutOfTen
          ? [`${point}`, `${point}.9`]
          : [`${point * 10}`, `${point * 10 + 9}`]
        return { label: from, name: `${from}${percent} to ${to}${percent}` }
      },
    }),
  }
}

/** Release years: each year across twenty or so, else decades. */
const RELEASE: Ruler = {
  unit: null,
  value: (entry) => entry.year,
  cut: ({ low, high }) =>
    high - low <= 20
      ? { of: (year) => year, face: yearFace }
      : {
          of: (year) => Math.floor(year / 10),
          face: (decade) => ({ label: `${decade * 10}s`, name: `The ${decade * 10}s` }),
        },
}

/** A TV library's bitrate step, the same whatever its shows run to. */
const SHOW_BITRATE_STEP = 5

/** Each field's ruler, for a library whose scores come from `source` and which may list shows. */
const rulers = ({
  source,
  hasShows,
}: {
  source: RatingSource
  hasShows: boolean
}): Record<JumpField, Ruler> => ({
  title: listed({
    list: LETTERS,
    item: (entry) => entry.letter,
    face: (letter) => ({
      label: letter,
      name: letter === SPECIAL_LETTERS.numbers ? 'Numbers and symbols' : letter,
    }),
  }),
  added: dates((entry) => entry.added),
  changed: dates((entry) => entry.changed),
  size: steps({
    unit: 'GB',
    value: (entry) => (entry.size == null ? null : entry.size / 1_000_000_000),
    step: null,
  }),
  bitrate: steps({
    unit: 'Mb/s',
    value: (entry) => (entry.bitrate == null ? null : entry.bitrate / 1_000_000),
    step: hasShows ? SHOW_BITRATE_STEP : null,
  }),
  resolution: listed({
    list: Object.values(RESOLUTIONS),
    item: (entry) => entry.resolution,
    face: (resolution) => ({ label: resolution.replace(/p$/, ''), name: resolution }),
  }),
  release: RELEASE,
  rating: scores(source),
})

/**
 * The jump strip for a listing in `sort` order: letters for titles, round
 * steps of bitrate or size, resolutions, years or decades, whole scores,
 * and months or years for when files came or changed. None for a random
 * order, which has nothing to jump by, nor for a TV library's order by
 * when files changed, which its shows do not have.
 */
export const jumpScale = ({
  sort,
  files,
  shows = [],
  source,
}: {
  sort: MediaSort
  files: readonly MediaItem[]
  shows?: readonly ShowEntry[]
  source: RatingSource
}): JumpScale | null => {
  const { field, direction } = sortParts(sort)
  const hasShows = shows.length > 0
  if (field === SORT_FIELD_NAMES.random || (hasShows && field === SORT_FIELD_NAMES.changed))
    return null
  const ruler = rulers({ source, hasShows })[field]
  const values = [
    ...shows.map((entry) => fromShow({ entry, source })),
    ...files.map((media) => fromMedia({ media, source })),
  ].map((entry) => ({ key: entry.key, value: ruler.value(entry) }))
  const known = values.flatMap(({ value }) => value ?? [])
  const range =
    ruler.full ??
    (known.length === 0 ? null : { low: Math.min(...known), high: Math.max(...known) })
  if (!range) return null
  const { of, face } = ruler.cut(range)
  const first = of(range.low)
  const marks = Array.from({ length: of(range.high) - first + 1 }, (_, at) => ({
    key: String(first + at),
    ...face(first + at),
  }))
  const entries = values.reduce((under, { key, value }) => {
    const mark = value == null ? UNKNOWN.key : String(of(value))
    return under.set(mark, (under.get(mark) ?? new Set<string>()).add(key))
  }, new Map<string, Set<string>>())
  return {
    field,
    unit: ruler.unit,
    // In the listing's direction, those for entries with no value last, as the server sorts them.
    marks: [
      ...(direction === SORT_DIRECTIONS.descending ? marks.toReversed() : marks),
      ...(known.length < values.length ? [UNKNOWN] : []),
    ],
    entries,
  }
}
