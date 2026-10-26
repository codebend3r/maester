import { describe, expect, it } from 'bun:test'
import type { HistoryEntry } from '@/contract'
import { finishedNote, historyDays, historyNote } from '@/history'
import { mediaItem } from '@/test/fixtures'

const entry = ({
  id = 1,
  playedAt,
  ...rest
}: { id?: number; playedAt: Date } & Partial<
  Pick<HistoryEntry, 'plays' | 'furthest' | 'watched' | 'marked'>
>): HistoryEntry => ({
  media: mediaItem({ id, duration: 100 }),
  lastPlayedAt: playedAt.toISOString(),
  plays: 1,
  furthest: 0,
  watched: false,
  marked: false,
  ...rest,
})

type DayNameProps = { date: Date; hasYear?: boolean }

const dayName = ({ date, hasYear = false }: DayNameProps): string =>
  new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(hasYear ? { year: 'numeric' } : {}),
  }).format(date)

const time = (date: Date): string =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)

describe('historyDays', () => {
  it('splits entries into the days they were played on, in local time', () => {
    const days = historyDays({
      entries: [
        entry({ id: 1, playedAt: new Date(2026, 9, 10, 20, 41) }),
        entry({ id: 2, playedAt: new Date(2026, 9, 10, 0, 5) }),
        entry({ id: 3, playedAt: new Date(2026, 9, 9, 23, 59) }),
        entry({ id: 4, playedAt: new Date(2026, 9, 6, 12, 0) }),
        entry({ id: 5, playedAt: new Date(2025, 11, 31, 12, 0) }),
      ],
      now: new Date(2026, 9, 10, 21, 0),
    })
    expect(days.map((day) => [day.label, day.entries.map((item) => item.media.id)])).toEqual([
      ['Today', [1, 2]],
      ['Yesterday', [3]],
      [dayName({ date: new Date(2026, 9, 6) }), [4]],
      [dayName({ date: new Date(2025, 11, 31), hasYear: true }), [5]],
    ])
  })
})

describe('historyNote', () => {
  const at = new Date(2026, 9, 10, 20, 41)

  it('says a watched video was watched, and when', () => {
    expect(historyNote(entry({ playedAt: at, furthest: 95, watched: true }))).toBe(
      `Watched · ${time(at)}`,
    )
  })

  it('says a marked video was marked watched, and when', () => {
    expect(historyNote(entry({ playedAt: at, watched: true, marked: true }))).toBe(
      `Marked watched · ${time(at)}`,
    )
  })

  it('counts only real plays beside a mark', () => {
    expect(historyNote(entry({ playedAt: at, watched: true, marked: true, plays: 2 }))).toBe(
      `Marked watched · ${time(at)} · 2 plays`,
    )
  })

  it('says how far an unfinished one got', () => {
    expect(historyNote(entry({ playedAt: at, furthest: 42.7 }))).toBe(`42% watched · ${time(at)}`)
  })

  it('counts the plays when there was more than one', () => {
    expect(historyNote(entry({ playedAt: at, furthest: 100, watched: true, plays: 3 }))).toBe(
      `Watched · ${time(at)} · 3 plays`,
    )
  })

  it('leaves out how far when the length is unknown', () => {
    const unmeasured = {
      ...entry({ playedAt: at, furthest: 50 }),
      media: mediaItem({ duration: null }),
    }
    expect(historyNote(unmeasured)).toBe(`Played · ${time(at)}`)
  })
})

describe('finishedNote', () => {
  it('names the day a finished video last played, and how often it has past once', () => {
    const now = new Date(2026, 9, 11, 20, 0)
    type FinishedProps = { playedAt: Date; plays?: number }

    const finished = ({ playedAt, plays = 1 }: FinishedProps) =>
      finishedNote({ entry: entry({ playedAt, plays, watched: true }), now })
    expect(finished({ playedAt: new Date(2026, 9, 11, 9, 0) })).toBe('Today')
    expect(finished({ playedAt: new Date(2026, 9, 10, 9, 0), plays: 3 })).toBe(
      'Yesterday · 3 plays',
    )
    expect(finished({ playedAt: new Date(2026, 9, 2, 9, 0) })).toBe(
      dayName({ date: new Date(2026, 9, 2) }),
    )
  })
})
