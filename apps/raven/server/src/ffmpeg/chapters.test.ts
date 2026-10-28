import { MARKER_KINDS, MARKER_SOURCES } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { chapterMarkers, parseChapters } from '@/ffmpeg/chapters'

type ChapterProps = { start: string; end: string; title?: string }

/** ffprobe's `-show_chapters` entry, as it writes one. */
const chapter = ({ start, end, title }: ChapterProps) => ({
  id: 0,
  time_base: '1/1000000000',
  start_time: start,
  end_time: end,
  ...(title !== undefined && { tags: { title } }),
})

describe('parseChapters', () => {
  it('reads each chapter in order, from the first at 0', () => {
    const output = {
      chapters: [
        chapter({ start: '91.007000', end: '1381.380000', title: 'Part A' }),
        chapter({ start: '0.000000', end: '91.007000', title: 'Opening' }),
        chapter({ start: '1381.380000', end: '1420.000000' }),
      ],
    }
    expect(parseChapters(output)).toEqual([
      { start: 0, end: 91.007, title: 'Opening' },
      { start: 91.007, end: 1381.38, title: 'Part A' },
      { start: 1381.38, end: 1420, title: null },
    ])
  })

  it('leaves out chapters with no length or no readable time, and reads none from a file without', () => {
    expect(
      parseChapters({
        chapters: [
          chapter({ start: '10.0', end: '10.0', title: 'Empty' }),
          chapter({ start: 'n/a', end: '12.0', title: 'Broken' }),
        ],
      }),
    ).toEqual([])
    expect(parseChapters({ streams: [] })).toEqual([])
    expect(parseChapters(null)).toEqual([])
  })
})

describe('chapterMarkers', () => {
  it('trusts chapters named as an intro or the credits', () => {
    const markers = chapterMarkers([
      { start: 0, end: 91, title: 'Opening' },
      { start: 91, end: 1381, title: 'Part A' },
      { start: 1381, end: 1470, title: 'Ending' },
      { start: 1470, end: 1500, title: 'Preview' },
    ])
    expect(markers).toEqual([
      {
        kind: MARKER_KINDS.intro,
        start: 0,
        end: 91,
        source: MARKER_SOURCES.chapter,
        confidence: 1,
      },
      {
        kind: MARKER_KINDS.credits,
        start: 1381,
        end: 1470,
        source: MARKER_SOURCES.chapter,
        confidence: 1,
      },
    ])
  })

  it.each(['End Credits', 'Credits', 'Cast and End Credits', 'closing credits'])(
    'takes a film whose last chapter is %s',
    (title) => {
      const markers = chapterMarkers([
        { start: 0, end: 5560, title: 'The Big Night' },
        { start: 5560, end: 5800, title },
      ])
      expect(markers.map(({ kind, start }) => ({ kind, start }))).toEqual([
        { kind: MARKER_KINDS.credits, start: 5560 },
      ])
    },
  )

  it('reads nothing into numbered, timestamp or untitled chapters', () => {
    expect(
      chapterMarkers([
        { start: 0, end: 60, title: 'Chapter 01' },
        { start: 60, end: 5658, title: '00:01:00.000' },
        { start: 5658, end: 5900, title: '01:34:18.277' },
        { start: 5900, end: 6000, title: null },
        { start: 6000, end: 6100, title: 'Opening Night' },
      ]),
    ).toEqual([])
  })
})
