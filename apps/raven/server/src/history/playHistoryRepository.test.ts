import { LIBRARY_KINDS, PLAYED_KINDS, PLAY_HISTORY_SHOWS } from '@raven/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseService } from '@/db/database'
import { PlayHistoryRepository } from '@/history/playHistoryRepository'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { ViewingRepository } from '@/media/viewingRepository'
import { testDatabase } from '@/test/database'
import { musicLibrary } from '@/test/musicLibrary'
import { planLikeProduction, tracedDatabase } from '@/test/queryPlans'
import { TEST_ACCOUNTS, repositories } from '@/test/repositories'

const { a: someone, b: another } = TEST_ACCOUNTS

const minute = (n: number): Date => new Date(Date.UTC(2026, 10, 1, 12, n))

type StoresProps = { database: DatabaseService }

const stores = ({ database }: StoresProps) => {
  const { media } = repositories(database)
  return {
    history: new PlayHistoryRepository(database, media),
    viewing: new ViewingRepository(database, media),
  }
}

type Seeded = { videoLibrary: number; musicLibrary: number; video: number; tracks: number[] }

const seed = (database: DatabaseService): Seeded => {
  const videoLibrary = new LibrariesRepository(database).create({
    name: 'Home videos',
    paths: ['/v'],
    settings: { kind: LIBRARY_KINDS.other },
  }).id
  const video = new MediaIndex(database).insert({
    libraryId: videoLibrary,
    kind: LIBRARY_KINDS.other,
    file: { path: '/v/Beach Day.mp4', root: '/v', size: 1, mtimeMs: 1 },
  })
  const { addLibrary, addTrack } = musicLibrary(database)
  const music = addLibrary({ name: 'Music' })
  const tracks = ['One', 'Two'].map((title) =>
    addTrack({ libraryId: music, title, artist: 'Band', album: 'Album' }),
  )
  return { videoLibrary, musicLibrary: music, video, tracks }
}

type PageOfProps = {
  database: DatabaseService
  whose: AccountKey | null
  hidden?: readonly number[]
  limit?: number
  before?: number | null
  show?: (typeof PLAY_HISTORY_SHOWS)[keyof typeof PLAY_HISTORY_SHOWS]
}

const pageOf = ({
  database,
  whose,
  hidden = [],
  limit = 50,
  before = null,
  show = PLAY_HISTORY_SHOWS.all,
}: PageOfProps) =>
  stores({ database }).history.page({
    whose,
    before,
    show,
    limit,
    scope: { account: someone, hidden },
  })

describe('the play history', () => {
  const database = testDatabase('raven-play-history-')
  const ids: Seeded = { videoLibrary: 0, musicLibrary: 0, video: 0, tracks: [] }

  beforeEach(async () => {
    await database.open()
    Object.assign(ids, seed(database.get()))
  })

  afterEach(() => database.close())

  it("keeps a video's sitting with its play, however short, and starts another after a break", () => {
    const { viewing } = stores({ database: database.get() })
    viewing.recordPlay({ id: ids.video, account: someone, at: minute(0) })
    viewing.report({ id: ids.video, position: 1, account: someone, at: minute(0) })
    viewing.report({ id: ids.video, position: 600, account: someone, at: minute(10) })
    viewing.recordPlay({ id: ids.video, account: someone, at: minute(50) })

    const { entries, next } = pageOf({ database: database.get(), whose: someone })

    expect(next).toBeNull()
    expect(
      entries.map(({ id, furthest, startedAt, lastPlayedAt }) => ({
        id,
        furthest,
        startedAt,
        lastPlayedAt,
      })),
    ).toEqual([
      {
        id: 2,
        furthest: 0,
        startedAt: minute(50).toISOString(),
        lastPlayedAt: minute(50).toISOString(),
      },
      {
        id: 1,
        furthest: 600,
        startedAt: minute(0).toISOString(),
        lastPlayedAt: minute(10).toISOString(),
      },
    ])
    expect(entries[0]?.played).toEqual({ kind: PLAYED_KINDS.video, title: 'Beach Day', year: null })
    expect(entries[0]?.libraryName).toBe('Home videos')
  })

  it('keeps each listen a music player starts, with its album and how far it got', () => {
    const { history } = stores({ database: database.get() })
    const first = history.startListen({
      account: someone,
      mediaId: ids.tracks[0]!,
      position: 0,
      at: minute(0),
    })
    const second = history.startListen({
      account: someone,
      mediaId: ids.tracks[1]!,
      position: 0,
      at: minute(4),
    })
    expect([first, second]).toEqual([1, 2])
    expect(history.reportListen({ account: someone, id: 1, position: 199, at: minute(3) })).toBe(
      true,
    )
    expect(history.reportListen({ account: someone, id: 1, position: 20, at: minute(3) })).toBe(
      true,
    )

    const { entries } = pageOf({ database: database.get(), whose: someone })

    expect(entries.map(({ id, furthest, played }) => ({ id, furthest, played }))).toEqual([
      {
        id: 2,
        furthest: 0,
        played: expect.objectContaining({
          kind: PLAYED_KINDS.track,
          title: 'Two',
          album: 'Album',
          artist: 'Band',
          albumTracks: 2,
        }),
      },
      {
        id: 1,
        furthest: 199,
        played: expect.objectContaining({ kind: PLAYED_KINDS.track, title: 'One' }),
      },
    ])
  })

  it("starts no listen on a video, and moves on no other account's listen", () => {
    const { history } = stores({ database: database.get() })
    expect(history.startListen({ account: someone, mediaId: ids.video, position: 0 })).toBeNull()
    const id = history.startListen({ account: someone, mediaId: ids.tracks[0]!, position: 0 })
    expect(id).toBe(1)
    expect(history.reportListen({ account: another, id: 1, position: 50 })).toBe(false)
    expect(pageOf({ database: database.get(), whose: someone }).entries[0]?.furthest).toBe(0)
  })

  it("keeps a video's play out of the listens, so a report there moves nothing", () => {
    const { viewing, history } = stores({ database: database.get() })
    viewing.recordPlay({ id: ids.video, account: someone })
    expect(history.reportListen({ account: someone, id: 1, position: 50 })).toBe(false)
  })

  it("reads an account's own entries alone, and everyone's for the owner, newest first", () => {
    const { history } = stores({ database: database.get() })
    history.startListen({ account: someone, mediaId: ids.tracks[0]!, position: 0, at: minute(0) })
    history.startListen({ account: another, mediaId: ids.tracks[1]!, position: 0, at: minute(1) })
    history.startListen({ account: someone, mediaId: ids.tracks[1]!, position: 0, at: minute(2) })

    const own = pageOf({ database: database.get(), whose: another }).entries
    const everyone = pageOf({ database: database.get(), whose: null }).entries

    expect(own.map(({ accountId, id }) => [accountId, id])).toEqual([[another, 2]])
    expect(everyone.map(({ accountId, id }) => [accountId, id])).toEqual([
      [someone, 3],
      [another, 2],
      [someone, 1],
    ])
  })

  it('pages on from a cursor, for one account and for everyone', () => {
    const { history } = stores({ database: database.get() })
    ;[0, 1, 2].forEach((n) =>
      history.startListen({
        account: n === 1 ? another : someone,
        mediaId: ids.tracks[0]!,
        position: 0,
        at: minute(n),
      }),
    )
    const ownFirst = pageOf({ database: database.get(), whose: someone, limit: 1 })
    const ownSecond = pageOf({
      database: database.get(),
      whose: someone,
      limit: 1,
      before: ownFirst.next,
    })
    expect([...ownFirst.entries, ...ownSecond.entries].map(({ id }) => id)).toEqual([3, 1])
    expect(ownSecond.next).toBeNull()

    const allFirst = pageOf({ database: database.get(), whose: null, limit: 2 })
    const allSecond = pageOf({
      database: database.get(),
      whose: null,
      limit: 2,
      before: allFirst.next,
    })
    expect([...allFirst.entries, ...allSecond.entries].map(({ startedAt }) => startedAt)).toEqual(
      [2, 1, 0].map((n) => minute(n).toISOString()),
    )
    expect(allSecond.next).toBeNull()
  })

  it('shows only videos or only music when asked, and leaves hidden libraries out', () => {
    const { history, viewing } = stores({ database: database.get() })
    viewing.recordPlay({ id: ids.video, account: someone, at: minute(0) })
    history.startListen({ account: someone, mediaId: ids.tracks[0]!, position: 0, at: minute(1) })

    const kindsOf = (show: PageOfProps['show'], hidden: readonly number[] = []) =>
      pageOf({ database: database.get(), whose: someone, show, hidden }).entries.map(
        ({ played }) => played.kind,
      )

    expect(kindsOf(PLAY_HISTORY_SHOWS.video)).toEqual([PLAYED_KINDS.video])
    expect(kindsOf(PLAY_HISTORY_SHOWS.music)).toEqual([PLAYED_KINDS.track])
    expect(kindsOf(PLAY_HISTORY_SHOWS.all, [ids.musicLibrary])).toEqual([PLAYED_KINDS.video])
  })

  it('drops a removed file’s entries with it', () => {
    const { history } = stores({ database: database.get() })
    history.startListen({ account: someone, mediaId: ids.tracks[0]!, position: 0 })
    database.get().db.prepare('DELETE FROM media WHERE id = ?').run(ids.tracks[0])
    expect(pageOf({ database: database.get(), whose: someone }).entries).toEqual([])
  })
})

type ReadProps = { database: DatabaseService; track: number }

type Read = (from: ReadProps) => unknown

const before = 900

/**
 * Every statement over the history that SQLite plans. A listen's start
 * reads only the track, and a video's sitting is an upsert by
 * `play_history_play`, so neither has a step over the history to read.
 */
const STATEMENTS = {
  'an account’s page': ({ database }) => pageOf({ database, whose: another }),
  'an account’s later page': ({ database }) => pageOf({ database, whose: another, before }),
  'an account’s music': ({ database }) =>
    pageOf({ database, whose: another, show: PLAY_HISTORY_SHOWS.music }),
  'everyone’s page': ({ database }) => pageOf({ database, whose: null }),
  'everyone’s later page': ({ database }) => pageOf({ database, whose: null, before }),
  'a listen reported': ({ database }) =>
    stores({ database }).history.reportListen({ account: another, id: 1, position: 9 }),
} as const satisfies Record<string, Read>

/** A step over the history, by its alias or its name. */
const HISTORY_STEP = /^[A-Z-]+ (h|play_history)\b/

/** An entry found by its id, or by its account's index, never every entry. */
const BY_KEY =
  /^SEARCH (h|play_history) USING (INTEGER PRIMARY KEY \(rowid[<=]\?\)|(COVERING )?INDEX play_history_account \(account_id=\? AND rowid[<=]\?\))/

describe.each([
  { statistics: 'no statistics', prepare: (): void => undefined },
  { statistics: 'many accounts’ statistics', prepare: planLikeProduction },
])('how the history is read, with $statistics', ({ prepare }) => {
  const database = testDatabase('raven-play-history-plans-')
  const ids = { track: 0 }

  beforeEach(async () => {
    await database.open()
    ids.track = seed(database.get()).tracks[0] ?? 0
    stores({ database: database.get() }).history.startListen({
      account: another,
      mediaId: ids.track,
      position: 0,
    })
    prepare(database.get())
  })

  afterEach(() => database.close())

  it.each(Object.entries(STATEMENTS))('reads %s by key, never every entry', (_name, read) => {
    const traced = tracedDatabase(database.get())
    try {
      read({ database: traced.database, track: ids.track })
      const steps = traced.steps().map((step) => step.detail)
      const history = steps.filter((detail) => HISTORY_STEP.test(detail))
      expect(history).not.toEqual([])
      expect(history.filter((detail) => !BY_KEY.test(detail))).toEqual([])
      expect(steps.filter((detail) => detail.includes('TEMP B-TREE FOR ORDER BY'))).toEqual([])
    } finally {
      traced.database.onModuleDestroy()
    }
  })

  it('clears a removed file’s entries by index', () => {
    const steps = database
      .get()
      .db.prepare<[number], { detail: string }>('EXPLAIN QUERY PLAN DELETE FROM media WHERE id = ?')
      .all(1)
      .map((row) => row.detail)
      .filter((detail) => HISTORY_STEP.test(detail))
    expect(steps).toEqual([
      expect.stringMatching(/^SEARCH play_history USING (COVERING )?INDEX play_history_media/u),
    ])
  })
})
