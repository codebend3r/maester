import {
  type DownloadView,
  type MediaSort,
  SORT_DIRECTIONS,
  type SortFieldName,
  sortParts,
  sortTitle,
} from '@raven/core'

type SortValue = string | number | null

type ValueOfProps = { view: DownloadView; seed: number }

const timeOf = (iso: string): number | null => {
  const time = Date.parse(iso)
  return Number.isNaN(time) ? null : time
}

const FNV_OFFSET = 2_166_136_261
const FNV_PRIME = 16_777_619
const UINT32 = 2 ** 32

/** A number between 0 and 1 that `text` always gives (FNV-1a), so a shuffle holds until it is dealt again. */
const unitOf = (text: string): number =>
  [...text].reduce(
    (hash, character) => Math.imul(hash ^ (character.codePointAt(0) ?? 0), FNV_PRIME) >>> 0,
    FNV_OFFSET,
  ) / UINT32

/** What each field a library sorts on reads off a download; null where the file has no such fact. */
const FIELD_VALUES = {
  title: ({ view }) => sortTitle(view.group.title),
  added: ({ view }) => timeOf(view.facts.addedAt),
  changed: ({ view }) => timeOf(view.facts.changedAt),
  size: ({ view }) => view.size,
  bitrate: ({ view }) => view.facts.bitrate,
  resolution: ({ view }) => view.facts.pixels,
  release: ({ view }) => view.facts.year,
  rating: ({ view }) => view.facts.score,
  random: ({ view, seed }) => unitOf(`${seed}:${view.downloadId}`),
} as const satisfies Record<SortFieldName, (props: ValueOfProps) => SortValue>

type CompareProps = { left: SortValue; right: SortValue }

/** Ascending order of two values; none sorts after any. */
const compareValues = ({ left, right }: CompareProps): number => {
  if (left === null || right === null) return Number(left === null) - Number(right === null)
  if (typeof left === 'string' && typeof right === 'string') return left.localeCompare(right)
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return 0
}

type SortDownloadsProps = {
  downloads: readonly DownloadView[]
  sort: MediaSort
  /** Deals the order of the random sort. */
  seed: number
}

/**
 * The downloads in the order of one of the sorts a library has, by the facts each kept of its
 * file. A file with no value for the field goes last whichever way it runs, and ties fall back to
 * the title and the play order, so a season's episodes stay in order.
 */
export const sortDownloads = ({ downloads, sort, seed }: SortDownloadsProps): DownloadView[] => {
  const { field, direction } = sortParts(sort)
  const value = FIELD_VALUES[field]
  const sign = direction === SORT_DIRECTIONS.descending ? -1 : 1
  return downloads.toSorted((a, b) => {
    const left = value({ view: a, seed })
    const right = value({ view: b, seed })
    const isEmpty = left === null || right === null
    return (
      compareValues({ left, right }) * (isEmpty ? 1 : sign) ||
      sortTitle(a.group.title).localeCompare(sortTitle(b.group.title)) ||
      a.group.order - b.group.order
    )
  })
}
