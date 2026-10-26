import { describe, expect, it } from 'bun:test'
import type { MediaItem, ShowEntry } from '@/contract'
import { mediaEntryKey } from '@/entryKeys'
import { jumpScale, niceStep } from '@/jumpScale'
import { itemSummary, mediaItem, showEntry } from '@/test/fixtures'

/** The strip's marks as `label` for the pressable ones and `(label)` for the rest. */
const strip = (scale: ReturnType<typeof jumpScale>): string[] =>
  scale?.marks.map((mark) => (scale.entries.has(mark.key) ? mark.label : `(${mark.label})`)) ?? []

type UnderProps = {
  scale: ReturnType<typeof jumpScale>
  label: string
}

/** The entries under the mark labelled `label`. */
const under = ({ scale, label }: UnderProps): string[] => {
  const mark = scale?.marks.find((each) => each.label === label)
  return [...(scale?.entries.get(mark?.key ?? '') ?? [])]
}

const movie = (overrides: Partial<MediaItem>) => mediaItem({ item: null, ...overrides })

describe('niceStep', () => {
  it('climbs by one, two or five times a power of ten, cutting the span into at most so many steps', () => {
    expect(niceStep({ span: 70, most: 16 })).toBe(5)
    expect(niceStep({ span: 79, most: 16 })).toBe(5)
    expect(niceStep({ span: 300, most: 16 })).toBe(20)
    expect(niceStep({ span: 9, most: 16 })).toBe(1)
    expect(niceStep({ span: 1.4, most: 16 })).toBe(0.1)
    expect(niceStep({ span: 0, most: 16 })).toBe(1)
  })
})

describe('jumpScale', () => {
  it('runs the alphabet for titles, Z to A when the order is turned around', () => {
    const files = [movie({ id: 1, title: 'Heat' }), movie({ id: 2, title: '2012' })]
    const az = jumpScale({ sort: 'title', files, source: 'tmdb' })
    expect(az?.field).toBe('title')
    expect(az?.marks.map((mark) => mark.label).slice(0, 3)).toEqual(['#', 'A', 'B'])
    expect(under({ scale: az, label: 'H' })).toEqual([mediaEntryKey(files[0] ?? movie({}))])
    const za = jumpScale({ sort: 'title-desc', files, source: 'tmdb' })
    expect(za?.marks.map((mark) => mark.label).slice(0, 2)).toEqual(['Z', 'Y'])
    expect(za?.marks.at(-1)?.label).toBe('#')
  })

  it('steps bitrate in round Mb/s, highest first, the files not probed yet last', () => {
    const scale = jumpScale({
      sort: 'bitrate-high',
      files: [
        movie({ id: 1, bitrate: 75_700_000 }),
        movie({ id: 2, bitrate: 71_500_000 }),
        movie({ id: 3, bitrate: 12_000_000 }),
        movie({ id: 4, bitrate: null }),
      ],
      source: 'tmdb',
    })
    expect(scale?.field).toBe('bitrate')
    expect(scale?.unit).toBe('Mb/s')
    expect(strip(scale)).toEqual([
      '75',
      '70',
      '(65)',
      '(60)',
      '(55)',
      '(50)',
      '(45)',
      '(40)',
      '(35)',
      '(30)',
      '(25)',
      '(20)',
      '(15)',
      '10',
      '?',
    ])
    expect(scale?.marks[0]?.name).toBe('75 to 80 Mb/s')
    expect(under({ scale, label: '?' })).toEqual(['media:4'])
  })

  it('steps size in round GB, smallest first when turned around', () => {
    const scale = jumpScale({
      sort: 'smallest',
      files: [movie({ id: 1, size: 12_400_000_000 }), movie({ id: 2, size: 61_000_000_000 })],
      source: 'tmdb',
    })
    expect(scale?.unit).toBe('GB')
    expect(strip(scale)).toEqual([
      '10',
      '(15)',
      '(20)',
      '(25)',
      '(30)',
      '(35)',
      '(40)',
      '(45)',
      '(50)',
      '(55)',
      '60',
    ])
  })

  it('reads a fine step without trailing zeros', () => {
    const scale = jumpScale({
      sort: 'smallest',
      files: [movie({ id: 1, size: 2_500_000_000 }), movie({ id: 2, size: 9_100_000_000 })],
      source: 'tmdb',
    })
    expect(strip(scale).slice(0, 3)).toEqual(['2.5', '(3)', '(3.5)'])
  })

  it('names resolutions, the most first', () => {
    const scale = jumpScale({
      sort: 'resolution-high',
      files: [
        movie({ id: 1, width: 3840, height: 2160 }),
        movie({ id: 2, width: 1280, height: 720 }),
      ],
      source: 'tmdb',
    })
    expect(strip(scale)).toEqual(['(8K)', '4K', '(1080)', '720', '(480)', '(320)', '(SD)'])
    expect(scale?.marks[2]?.name).toBe('1080p')
  })

  it('runs years across twenty or so, and decades past that', () => {
    const years = (list: number[]) =>
      list.map((year, id) => movie({ id, item: itemSummary({ id: id + 100, year }) }))
    expect(
      strip(jumpScale({ sort: 'year-old', files: years([2019, 2022]), source: 'tmdb' })),
    ).toEqual(['2019', '(2020)', '(2021)', '2022'])
    const decades = jumpScale({
      sort: 'year-new',
      files: years([1972, 1999, 2024]),
      source: 'tmdb',
    })
    expect(strip(decades)).toEqual(['2020s', '(2010s)', '(2000s)', '1990s', '(1980s)', '1970s'])
    expect(decades?.marks[0]?.name).toBe('The 2020s')
  })

  it("steps scores by whole points, written the way the library's source writes them", () => {
    type RatedProps = { value: number; id: number }

    const rated = ({ value, id }: RatedProps) =>
      movie({
        id,
        item: itemSummary({
          id: id + 100,
          ratings: [
            { source: 'imdb', kind: 'audience', value, votes: null },
            { source: 'rottenTomatoes', kind: 'critic', value, votes: null },
          ],
        }),
      })
    const files = [rated({ value: 8.6, id: 1 }), rated({ value: 6.4, id: 2 })]
    const imdb = jumpScale({ sort: 'rating-high', files, source: 'imdb' })
    expect(strip(imdb)).toEqual(['8', '(7)', '6'])
    expect(imdb?.unit).toBeNull()
    const tomatoes = jumpScale({ sort: 'rating-high', files, source: 'rottenTomatoes' })
    expect(tomatoes?.unit).toBe('%')
    expect(strip(tomatoes)).toEqual(['80', '(70)', '60'])
    expect(tomatoes?.marks[0]?.name).toBe('80% to 89%')
    expect(imdb?.marks[0]?.name).toBe('8 to 8.9')
  })

  it('runs months across a year or so of arrivals, and years past that', () => {
    const came = (dates: string[]) => dates.map((addedAt, id) => movie({ id, addedAt }))
    const months = jumpScale({
      sort: 'added',
      files: came(['2026-10-03T12:00:00Z', '2026-08-20T12:00:00Z']),
      source: 'tmdb',
    })
    expect(months?.marks).toHaveLength(3)
    expect(months?.marks[0]?.name).toContain('2026')
    expect(strip(months).filter((label) => !label.startsWith('('))).toHaveLength(2)
    const years = jumpScale({
      sort: 'oldest',
      files: came(['2023-06-01T12:00:00Z', '2026-10-01T12:00:00Z']),
      source: 'tmdb',
    })
    expect(strip(years)).toEqual(['2023', '(2024)', '(2025)', '2026'])
  })

  it('has no strip for a random order, nor for values no file has yet', () => {
    const files = [movie({ id: 1, bitrate: null })]
    expect(jumpScale({ sort: 'random', files, source: 'tmdb' })).toBeNull()
    expect(jumpScale({ sort: 'bitrate-high', files, source: 'tmdb' })).toBeNull()
  })

  it("steps a TV library's bitrate every 5 Mb/s, its shows by their files' mean bitrate", () => {
    const shows: ShowEntry[] = [
      {
        ...showEntry(),
        show: itemSummary({ id: 9, type: 'show', title: 'The Wire' }),
        bitrate: 3_200_000,
      },
      {
        ...showEntry(),
        show: itemSummary({ id: 8, type: 'show', title: 'Severance' }),
        bitrate: 17_900_000,
      },
    ]
    const scale = jumpScale({ sort: 'bitrate-high', files: [], shows, source: 'tmdb' })
    expect(scale?.field).toBe('bitrate')
    expect(strip(scale)).toEqual(['15', '(10)', '(5)', '0'])
    expect(under({ scale, label: '0' })).toEqual(['show:9'])
  })

  it("has no strip for a TV library's order by when files changed, which its shows do not have", () => {
    const show = { ...showEntry(), show: itemSummary({ id: 9, type: 'show', title: 'The Wire' }) }
    const files = [movie({ id: 1, changedAt: '2026-10-03T12:00:00Z' })]
    expect(jumpScale({ sort: 'changed', files, shows: [show], source: 'tmdb' })).toBeNull()
    expect(
      under({
        scale: jumpScale({ sort: 'title', files, shows: [show], source: 'tmdb' }),
        label: 'W',
      }),
    ).toEqual(['show:9'])
  })

  it('reads months in UTC, as the grouped view buckets them', () => {
    const scale = jumpScale({
      sort: 'oldest',
      files: [
        movie({ id: 1, addedAt: '2026-08-31T23:30:00Z' }),
        movie({ id: 2, addedAt: '2026-09-01T00:30:00Z' }),
      ],
      source: 'tmdb',
    })
    expect(strip(scale)).toHaveLength(2)
    expect(strip(scale).filter((label) => !label.startsWith('('))).toHaveLength(2)
  })
})
