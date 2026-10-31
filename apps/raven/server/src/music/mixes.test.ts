import { LIBRARY_KINDS, MIX_KINDS } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ViewingRepository } from '@/media/viewingRepository'
import { Mixes } from '@/music/mixes'
import { manualClock } from '@/test/clock'
import { testDatabase } from '@/test/database'
import { musicLibrary } from '@/test/musicLibrary'
import { TEST_ACCOUNTS, repositories } from '@/test/repositories'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const NOW = Date.parse('2026-10-31T12:00:00Z')

const account = TEST_ACCOUNTS.b

type PlayProps = { id: number; times: number; from: number }

describe('Mixes', () => {
  const database = testDatabase('raven-mixes-')
  const state: {
    open: number
    locked: number
    spins: number[]
    old: number[]
    hidden: number
    chapters: number[]
  } = { open: 0, locked: 0, spins: [], old: [], hidden: 0, chapters: [] }
  const clock = manualClock()
  const mixes = () => {
    const { music } = musicLibrary(database.get())
    return new Mixes(database.get(), music, clock.clock)
  }
  const scope = () => ({ account, hidden: [state.locked] })

  beforeAll(async () => {
    await database.open()
    clock.advance(NOW)
    const { addLibrary, addTrack } = musicLibrary(database.get())
    const viewing = new ViewingRepository(database.get(), repositories(database.get()).media)
    const longAgo = new Date(NOW - 200 * DAY_MS)
    state.open = addLibrary({ name: 'Music' })
    state.locked = addLibrary({ name: 'Private', isLocked: true })
    state.spins = Array.from({ length: 12 }, (_, at) =>
      addTrack({
        libraryId: state.open,
        title: `Spin ${at}`,
        artist: 'Hot',
        album: 'Spins',
        at: longAgo,
      }),
    )
    state.old = Array.from({ length: 9 }, (_, at) =>
      addTrack({
        libraryId: state.open,
        title: `Old ${at}`,
        artist: 'Old',
        album: 'Olds',
        at: longAgo,
      }),
    )
    state.hidden = addTrack({
      libraryId: state.locked,
      title: 'Secret',
      artist: 'Hot',
      album: 'Hidden',
      at: longAgo,
    })
    // An audiobook's chapters are filed as tracks, played and added lately, by a mix's artist.
    const books = addLibrary({ name: 'Books', kind: LIBRARY_KINDS.audiobooks })
    state.chapters = ['Hot', 'Old', 'Hot'].map((artist, at) =>
      addTrack({
        libraryId: books,
        title: `Chapter ${at}`,
        artist,
        album: 'A Book',
        at: new Date(NOW - 2 * DAY_MS),
      }),
    )
    /** Plays an hour apart from `from` on, so each is a sitting of its own. */
    const play = ({ id, times, from }: PlayProps) =>
      Array.from({ length: times }, (_, at) =>
        viewing.recordPlay({ id, account, at: new Date(from + at * HOUR_MS) }),
      )
    const [first = 0, second = 0, third = 0] = state.spins
    play({ id: first, times: 5, from: NOW - DAY_MS })
    play({ id: second, times: 4, from: NOW - DAY_MS })
    play({ id: third, times: 3, from: NOW - DAY_MS })
    play({ id: state.hidden, times: 9, from: NOW - 20 * HOUR_MS })
    state.old.forEach((id) => play({ id, times: 3, from: NOW - 120 * DAY_MS }))
    const [heard = 0, heardLongAgo = 0] = state.chapters
    play({ id: heard, times: 9, from: NOW - 20 * HOUR_MS })
    play({ id: heardLongAgo, times: 3, from: Date.parse('2019-10-31T01:00:00Z') })
    // Another account's plays make none of this account's mixes.
    viewing.recordPlay({ id: state.old[0] ?? 0, account: TEST_ACCOUNTS.a, at: new Date(NOW) })
  })

  afterAll(() => database.close())

  it('holds the three most played tracks in heavy rotation, with the artist’s unplayed ones', () => {
    const mix = mixes().get({ kind: MIX_KINDS.heavyRotation, ...scope() })
    const ids = mix?.tracks.map(({ id }) => id) ?? []

    expect(ids).toHaveLength(12)
    expect(ids).toEqual(expect.arrayContaining(state.spins.slice(0, 3)))
    expect(ids.toSorted((a, b) => a - b)).toEqual(state.spins)
    expect(mix?.mix).toMatchObject({ id: MIX_KINDS.heavyRotation, trackCount: 12, duration: 2400 })
  })

  it('leaves out a mix of nine tracks', () => {
    expect(mixes().get({ kind: MIX_KINDS.rediscover, ...scope() })).toBeNull()
    expect(
      mixes()
        .list(scope())
        .map(({ id }) => id),
    ).toEqual([MIX_KINDS.heavyRotation])
  })

  it('makes rediscover once it has ten tracks played three times long ago', () => {
    const viewing = new ViewingRepository(database.get(), repositories(database.get()).media)
    const { addTrack } = musicLibrary(database.get())
    const tenth = addTrack({ libraryId: state.open, title: 'Old 9', artist: 'Old', album: 'Olds' })
    ;[0, 1, 2].forEach((at) =>
      viewing.recordPlay({ id: tenth, account, at: new Date(NOW - 100 * DAY_MS + at * HOUR_MS) }),
    )
    try {
      const mix = mixes().get({ kind: MIX_KINDS.rediscover, ...scope() })
      expect(mix?.tracks.map(({ id }) => id).toSorted((a, b) => a - b)).toEqual([
        ...state.old,
        tenth,
      ])
      expect(
        mixes().get({ kind: MIX_KINDS.rediscover, account: TEST_ACCOUNTS.a, hidden: [] }),
      ).toBeNull()
    } finally {
      database.get().db.prepare('DELETE FROM media WHERE id = ?').run(tenth)
      musicLibrary(database.get()).music.prune()
    }
  })

  it('deals the same order all day and another the next', () => {
    const orderAt = (now: number) => {
      const at = manualClock()
      at.advance(now)
      const { music } = musicLibrary(database.get())
      return new Mixes(database.get(), music, at.clock)
        .get({ kind: MIX_KINDS.heavyRotation, ...scope() })
        ?.tracks.map(({ id }) => id)
    }
    const today = orderAt(NOW)

    expect(orderAt(NOW + 11 * HOUR_MS)).toEqual(today)
    expect(orderAt(NOW + DAY_MS)).not.toEqual(today)
  })

  it('never holds a locked library’s tracks, nor shows its albums on Home', () => {
    const mix = mixes().get({ kind: MIX_KINDS.heavyRotation, ...scope() })
    const recent = mixes().recent(scope())

    expect(mix?.tracks.map(({ id }) => id)).not.toContain(state.hidden)
    expect(recent.played.map(({ title }) => title)).toEqual(['Spins', 'Olds'])
    expect(recent.added.map(({ title }) => title).toSorted()).toEqual(['Olds', 'Spins'])
    // With the PIN entered nothing is hidden, and the locked album was played last.
    expect(
      mixes()
        .recent({ account, hidden: [] })
        .played.map(({ title }) => title),
    ).toEqual(['Hidden', 'Spins', 'Olds'])
  })

  it('makes recently added from the albums added in the last 30 days', () => {
    const { addTrack } = musicLibrary(database.get())
    const fresh = Array.from({ length: 10 }, (_, at) =>
      addTrack({
        libraryId: state.open,
        title: `New ${at}`,
        artist: 'New',
        album: 'Fresh',
        at: new Date(NOW - 2 * DAY_MS),
      }),
    )
    const mix = mixes().get({ kind: MIX_KINDS.recentlyAdded, ...scope() })
    expect(mix?.tracks.map(({ id }) => id).toSorted((a, b) => a - b)).toEqual(fresh)
  })

  it('makes on this day from what was played on this date in an earlier year', () => {
    const viewing = new ViewingRepository(database.get(), repositories(database.get()).media)
    const { addTrack } = musicLibrary(database.get())
    const tracks = Array.from({ length: 12 }, (_, at) =>
      addTrack({ libraryId: state.open, title: `Year ${at}`, artist: 'Then', album: 'Then' }),
    )
    const [today = 0, dayBefore = 0, ...lastYear] = tracks
    lastYear.forEach((id, at) =>
      viewing.recordPlay({
        id,
        account,
        at: new Date(`${2015 + at}-10-31T${String(at).padStart(2, '0')}:30:00Z`),
      }),
    )
    viewing.recordPlay({ id: today, account, at: new Date(NOW - HOUR_MS) })
    viewing.recordPlay({ id: dayBefore, account, at: new Date('2025-10-30T23:59:00Z') })

    const ids = mixes()
      .get({ kind: MIX_KINDS.onThisDay, ...scope() })
      ?.tracks.map(({ id }) => id)
    expect(ids?.toSorted((a, b) => a - b)).toEqual(lastYear)
  })

  it('keeps the three most played in heavy rotation when there are more tracks than it holds', () => {
    const { addTrack } = musicLibrary(database.get())
    Array.from({ length: 60 }, (_, at) =>
      addTrack({ libraryId: state.open, title: `B-side ${at}`, artist: 'Hot', album: 'B-sides' }),
    )
    const ids = mixes()
      .get({ kind: MIX_KINDS.heavyRotation, ...scope() })
      ?.tracks.map(({ id }) => id)

    expect(ids).toHaveLength(50)
    expect(ids).toEqual(expect.arrayContaining(state.spins.slice(0, 3)))
  })

  it('never holds an audiobook’s chapters, nor shows its album on Home', () => {
    const held = Object.values(MIX_KINDS).flatMap(
      (kind) =>
        mixes()
          .get({ kind, ...scope() })
          ?.tracks.map(({ id }) => id) ?? [],
    )
    const recent = mixes().recent({ account, hidden: [] })

    expect(held.filter((id) => state.chapters.includes(id))).toEqual([])
    expect([...recent.played, ...recent.added].map(({ title }) => title)).not.toContain('A Book')
  })
})
