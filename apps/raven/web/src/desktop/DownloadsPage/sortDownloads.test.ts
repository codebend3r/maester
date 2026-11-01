import { describe, expect, it } from 'bun:test'
import {
  type DownloadFacts,
  DOWNLOAD_KINDS,
  MEDIA_SORTS,
  SORT_FIELD_NAMES,
  sortOf,
  startingSort,
} from '@raven/core'
import { sortDownloads } from '@/desktop/DownloadsPage/sortDownloads'
import { viewOf } from '@/test/desktop'

const SERVER_FACTS: DownloadFacts = {
  year: null,
  score: null,
  bitrate: null,
  pixels: null,
  addedAt: '2026-01-01T00:00:00.000Z',
  changedAt: '2026-01-01T00:00:00.000Z',
}

type TitledProps = { n: number; title: string; facts?: Partial<DownloadFacts>; size?: number }

const titled = ({ n, title, facts = {}, size = 100 }: TitledProps) =>
  viewOf({
    downloadId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    label: title,
    group: { kind: DOWNLOAD_KINDS.movie, key: `movie:${n}`, title, order: 0 },
    size,
    facts: { ...SERVER_FACTS, ...facts },
  })

const titlesOf = (views: ReturnType<typeof titled>[]) => views.map((view) => view.group.title)

const A = titled({
  n: 1,
  title: 'The Alpha',
  size: 300,
  facts: { year: 1999, score: 7, bitrate: 4, pixels: 100, addedAt: '2026-03-01T00:00:00.000Z' },
})
const B = titled({
  n: 2,
  title: 'Bravo',
  size: 100,
  facts: { year: 2010, score: 9, bitrate: 8, pixels: 400, changedAt: '2026-05-01T00:00:00.000Z' },
})
const C = titled({ n: 3, title: 'Charlie', size: 200 })

const sorted = (sort: Parameters<typeof sortDownloads>[0]['sort']) =>
  titlesOf(sortDownloads({ downloads: [C, A, B], sort, seed: 1 }))

describe('sortDownloads', () => {
  it('sorts by title without the leading article, either way', () => {
    expect(sorted(MEDIA_SORTS.title)).toEqual(['The Alpha', 'Bravo', 'Charlie'])
    expect(sorted(MEDIA_SORTS.titleDesc)).toEqual(['Charlie', 'Bravo', 'The Alpha'])
  })

  it('sorts by size', () => {
    expect(sorted(MEDIA_SORTS.smallest)).toEqual(['Bravo', 'Charlie', 'The Alpha'])
    expect(sorted(MEDIA_SORTS.largest)).toEqual(['The Alpha', 'Charlie', 'Bravo'])
  })

  it('sorts by every field a library has, putting a file with no value last either way', () => {
    const fields = Object.values(SORT_FIELD_NAMES).filter((field) => field !== 'random')
    fields.forEach((field) => {
      const ascending = sortDownloads({
        downloads: [C, A, B],
        sort: sortOf({ field, direction: 'ascending' }),
        seed: 1,
      })
      expect(ascending).toHaveLength(3)
    })
    expect(sorted(MEDIA_SORTS.yearOld)).toEqual(['The Alpha', 'Bravo', 'Charlie'])
    expect(sorted(MEDIA_SORTS.yearNew)).toEqual(['Bravo', 'The Alpha', 'Charlie'])
    expect(sorted(MEDIA_SORTS.ratingHigh)).toEqual(['Bravo', 'The Alpha', 'Charlie'])
    expect(sorted(MEDIA_SORTS.ratingLow)).toEqual(['The Alpha', 'Bravo', 'Charlie'])
    expect(sorted(MEDIA_SORTS.bitrateHigh)).toEqual(['Bravo', 'The Alpha', 'Charlie'])
    expect(sorted(MEDIA_SORTS.resolutionLow)).toEqual(['The Alpha', 'Bravo', 'Charlie'])
  })

  it('sorts by when the file was added and when it changed', () => {
    expect(sorted(MEDIA_SORTS.added)[0]).toBe('The Alpha')
    expect(sorted(MEDIA_SORTS.changed)[0]).toBe('Bravo')
    expect(sorted(MEDIA_SORTS.oldest).at(-1)).toBe('The Alpha')
  })

  it('shuffles the same way for a seed, and another way for another', () => {
    const once = sortDownloads({ downloads: [A, B, C], sort: startingSort('random'), seed: 1 })
    const again = sortDownloads({ downloads: [C, B, A], sort: startingSort('random'), seed: 1 })
    expect(titlesOf(once)).toEqual(titlesOf(again))
    const orders = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) =>
        titlesOf(
          sortDownloads({ downloads: [A, B, C], sort: startingSort('random'), seed }),
        ).join(),
      ),
    )
    expect(orders.size).toBeGreaterThan(1)
  })

  it('keeps a season in play order when its titles tie', () => {
    const group = { kind: DOWNLOAD_KINDS.season, key: 'show:4', title: 'Severance' } as const
    const second = viewOf({ label: 'S01E02', group: { ...group, order: 10_002 } })
    const first = viewOf({ label: 'S01E01', group: { ...group, order: 10_001 } })
    expect(
      sortDownloads({ downloads: [second, first], sort: MEDIA_SORTS.title, seed: 1 }).map(
        ({ label }) => label,
      ),
    ).toEqual(['S01E01', 'S01E02'])
  })

  it('does not change the list it is given', () => {
    const input = [C, A, B]
    sortDownloads({ downloads: input, sort: MEDIA_SORTS.title, seed: 1 })
    expect(titlesOf(input)).toEqual(['Charlie', 'The Alpha', 'Bravo'])
  })
})
