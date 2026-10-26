import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { FAVOURITE_OUTCOMES } from '@/media/favouriteOutcomes'
import { MediaIndex } from '@/media/mediaIndex'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { ViewingRepository } from '@/media/viewingRepository'
import { PLAY_KINDS } from '@/media/watchedRepository'
import { testDatabase } from '@/test/database'
import { TEST_ACCOUNTS, repositories } from '@/test/repositories'

const MINUTE = {
  duration: 60,
  width: 1920,
  height: 1080,
  videoCodec: 'h264',
  videoBitDepth: 8,
  hdr: false,
  audioCodec: 'aac',
  audioChannels: 2,
  bitrate: 5_000_000,
}

type PlayKind = (typeof PLAY_KINDS)[keyof typeof PLAY_KINDS]

describe('play history', () => {
  const database = testDatabase('raven-history-')
  const media = () => repositories(database.get()).media
  const viewing = () => new ViewingRepository(database.get(), media())
  const index = () => new MediaIndex(database.get())
  const libraries = () => new LibrariesRepository(database.get())
  const createLibrary = (name: string): number =>
    libraries().create({ name, paths: [`/${name}`] }).id
  type AddProps = { libraryId: number; name: string }

  const add = ({ libraryId, name }: AddProps): number =>
    index().insert({
      libraryId,
      kind: 'other',
      file: { path: `/${libraryId}/${name}.mp4`, root: `/${libraryId}`, size: 100, mtimeMs: 1 },
    })
  type AddMinuteProps = { libraryId: number; name: string }

  /** A one-minute video, so seconds read straight across as sixtieths. */
  const addMinute = ({ libraryId, name }: AddMinuteProps): number => {
    const id = add({ libraryId, name })
    index().saveProbe({
      id,
      probe: MINUTE,
      tracks: { audio: [], subtitles: [], defaultAudio: null, frameRate: 24 },
    })
    return id
  }
  const watchedIds = (libraryId: number): number[] =>
    viewing()
      .history({ libraryId, limit: 100, watchedOnly: true, account: TEST_ACCOUNTS.a })
      .map((entry) => entry.media.id)
  /** A time on 10 October 2026, this many minutes after 7pm UTC. */
  const at = (minutes: number): Date => new Date(Date.UTC(2026, 9, 10, 19, minutes))
  type HistoryProps = { libraryId: number; limit?: number }

  const history = ({ libraryId, limit = 100 }: HistoryProps) =>
    viewing()
      .history({ libraryId, limit, account: TEST_ACCOUNTS.a })
      .map((entry) => ({
        id: entry.media.id,
        lastPlayedAt: entry.lastPlayedAt,
        plays: entry.plays,
      }))
  type AddPlayProps = {
    id: number
    at: Date
    furthest: number
    kind: PlayKind
  }

  /** A play of `kind` written straight to the table, as account A's. */
  const addPlay = ({ id, at: playedAt, furthest, kind }: AddPlayProps): void => {
    database
      .get()
      .db.prepare(
        `INSERT INTO plays (account_id, media_id, played_at, furthest, kind)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(TEST_ACCOUNTS.a, id, playedAt.toISOString(), furthest, kind)
  }
  const positionOf = (id: number): number =>
    media().get({ id, account: TEST_ACCOUNTS.a })?.position ?? -1

  beforeAll(database.open)
  afterAll(database.close)

  it('counts a video started again within half an hour as the same play', () => {
    const libraryId = createLibrary('sitting')
    const id = add({ libraryId, name: 'film' })
    viewing().recordPlay({ id, at: at(0), account: TEST_ACCOUNTS.a })
    viewing().recordPlay({ id, at: at(25), account: TEST_ACCOUNTS.a })
    expect(history({ libraryId })).toEqual([{ id, lastPlayedAt: at(25).toISOString(), plays: 1 }])
    viewing().recordPlay({ id, at: at(56), account: TEST_ACCOUNTS.a })
    expect(history({ libraryId })).toEqual([{ id, lastPlayedAt: at(56).toISOString(), plays: 2 }])
  })

  it('lists each played video once, by when it last played', () => {
    const libraryId = createLibrary('order')
    const first = add({ libraryId, name: 'first' })
    const second = add({ libraryId, name: 'second' })
    add({ libraryId, name: 'never' })
    viewing().recordPlay({ id: first, at: at(0), account: TEST_ACCOUNTS.a })
    viewing().recordPlay({ id: second, at: at(10), account: TEST_ACCOUNTS.a })
    viewing().recordPlay({ id: first, at: at(100), account: TEST_ACCOUNTS.a })
    expect(history({ libraryId })).toEqual([
      { id: first, lastPlayedAt: at(100).toISOString(), plays: 2 },
      { id: second, lastPlayedAt: at(10).toISOString(), plays: 1 },
    ])
  })

  it('keeps to its own library and to the limit', () => {
    const libraryId = createLibrary('mine')
    const otherId = createLibrary('theirs')
    const older = add({ libraryId, name: 'older' })
    const newer = add({ libraryId, name: 'newer' })
    viewing().recordPlay({ id: older, at: at(0), account: TEST_ACCOUNTS.a })
    viewing().recordPlay({ id: newer, at: at(5), account: TEST_ACCOUNTS.a })
    viewing().recordPlay({
      id: add({ libraryId: otherId, name: 'elsewhere' }),
      at: at(9),
      account: TEST_ACCOUNTS.a,
    })
    expect(history({ libraryId }).map((entry) => entry.id)).toEqual([newer, older])
    expect(history({ libraryId, limit: 1 }).map((entry) => entry.id)).toEqual([newer])
  })

  it("counts a video as watched once a play gets past its library's percentage", () => {
    const libraryId = createLibrary('threshold')
    const id = addMinute({ libraryId, name: 'minute' })
    const entry = () => viewing().history({ libraryId, limit: 100, account: TEST_ACCOUNTS.a })[0]
    viewing().recordPlay({ id, at: at(0), account: TEST_ACCOUNTS.a })
    viewing().report({ id, position: 50, at: at(1), account: TEST_ACCOUNTS.a })
    expect(entry()).toMatchObject({ furthest: 50, watched: false })
    viewing().report({ id, position: 20, at: at(2), account: TEST_ACCOUNTS.a })
    expect(entry()).toMatchObject({ furthest: 50, watched: false })
    viewing().report({ id, position: 57, at: at(3), account: TEST_ACCOUNTS.a })
    expect(entry()).toMatchObject({ furthest: 57, watched: true, plays: 1 })
  })

  it('moves the bar when the library changes its percentage', () => {
    const libraryId = createLibrary('lenient')
    const id = addMinute({ libraryId, name: 'minute' })
    viewing().report({ id, position: 30, at: at(0), account: TEST_ACCOUNTS.a })
    expect(watchedIds(libraryId)).toEqual([])
    libraries().update({
      id: libraryId,
      input: { name: 'lenient', paths: ['/lenient'], settings: { watchedPercent: 50 } },
    })
    expect(watchedIds(libraryId)).toEqual([id])
  })

  it('lists only the watched videos when asked', () => {
    const libraryId = createLibrary('filtered')
    const finished = addMinute({ libraryId, name: 'finished' })
    const started = addMinute({ libraryId, name: 'started' })
    viewing().report({ id: finished, position: 60, at: at(0), account: TEST_ACCOUNTS.a })
    viewing().report({ id: started, position: 10, at: at(5), account: TEST_ACCOUNTS.a })
    expect(history({ libraryId }).map((entry) => entry.id)).toEqual([started, finished])
    expect(watchedIds(libraryId)).toEqual([finished])
  })

  it('never counts a video it cannot measure as watched', () => {
    const libraryId = createLibrary('unprobed')
    const id = add({ libraryId, name: 'unknown length' })
    viewing().report({ id, position: 5000, at: at(0), account: TEST_ACCOUNTS.a })
    expect(viewing().history({ libraryId, limit: 100, account: TEST_ACCOUNTS.a })[0]).toMatchObject(
      { watched: false },
    )
  })

  it('forgets the plays of a video that leaves the library', () => {
    const libraryId = createLibrary('gone')
    const id = add({ libraryId, name: 'deleted' })
    viewing().recordPlay({ id, at: at(0), account: TEST_ACCOUNTS.a })
    index().remove([id])
    expect(history({ libraryId })).toEqual([])
  })

  it('saves the spot to resume from with the play, and starting a play keeps it', () => {
    const libraryId = createLibrary('resume')
    const id = addMinute({ libraryId, name: 'film' })
    expect(viewing().report({ id, position: 30, at: at(0), account: TEST_ACCOUNTS.a })).toBe(true)
    expect(positionOf(id)).toBe(30)
    viewing().recordPlay({ id, at: at(90), account: TEST_ACCOUNTS.a })
    expect(positionOf(id)).toBe(30)
    viewing().report({ id, position: 2, at: at(91), account: TEST_ACCOUNTS.a })
    expect(positionOf(id)).toBe(0)
  })

  it('keeps the history but no spot while its library saves no progress', () => {
    const libraryId = createLibrary('forgetful')
    libraries().update({
      id: libraryId,
      input: { name: 'forgetful', paths: ['/forgetful'], settings: { saveProgress: false } },
    })
    const id = addMinute({ libraryId, name: 'film' })
    viewing().report({ id, position: 30, at: at(0), account: TEST_ACCOUNTS.a })
    expect(positionOf(id)).toBe(0)
    expect(viewing().history({ libraryId, limit: 100, account: TEST_ACCOUNTS.a })[0]).toMatchObject(
      { furthest: 30 },
    )
  })

  it('clears the spot at the library’s watched percentage, and not before', () => {
    const libraryId = createLibrary('threshold-spot')
    const id = addMinute({ libraryId, name: 'minute' })
    viewing().report({ id, position: 56, at: at(0), account: TEST_ACCOUNTS.a })
    expect(positionOf(id)).toBe(56)
    viewing().report({ id, position: 57, at: at(1), account: TEST_ACCOUNTS.a })
    expect(positionOf(id)).toBe(0)
    expect(watchedIds(libraryId)).toEqual([id])
  })

  it('clears the spot where a lower percentage says, and keeps one a higher percentage allows', () => {
    const halfway = createLibrary('halfway')
    libraries().update({
      id: halfway,
      input: { name: 'halfway', paths: ['/halfway'], settings: { watchedPercent: 50 } },
    })
    const early = addMinute({ libraryId: halfway, name: 'early' })
    viewing().report({ id: early, position: 29, at: at(0), account: TEST_ACCOUNTS.a })
    expect(positionOf(early)).toBe(29)
    viewing().report({ id: early, position: 30, at: at(1), account: TEST_ACCOUNTS.a })
    expect(positionOf(early)).toBe(0)
    const strict = createLibrary('strict')
    libraries().update({
      id: strict,
      input: { name: 'strict', paths: ['/strict'], settings: { watchedPercent: 100 } },
    })
    const late = addMinute({ libraryId: strict, name: 'late' })
    viewing().report({ id: late, position: 59, at: at(0), account: TEST_ACCOUNTS.a })
    expect(positionOf(late)).toBe(59)
  })

  it('keeps the spots of a library that saves no progress, even past the threshold', () => {
    const libraryId = createLibrary('keeps-spots')
    const id = addMinute({ libraryId, name: 'film' })
    viewing().report({ id, position: 30, at: at(0), account: TEST_ACCOUNTS.a })
    libraries().update({
      id: libraryId,
      input: { name: 'keeps-spots', paths: ['/keeps-spots'], settings: { saveProgress: false } },
    })
    viewing().report({ id, position: 60, at: at(1), account: TEST_ACCOUNTS.a })
    libraries().update({
      id: libraryId,
      input: { name: 'keeps-spots', paths: ['/keeps-spots'], settings: { saveProgress: true } },
    })
    expect(positionOf(id)).toBe(30)
  })

  it('never continues a mark or a play set aside, so playing again starts a new play', () => {
    const libraryId = createLibrary('sittings')
    const id = addMinute({ libraryId, name: 'film' })
    const db = database.get().db
    addPlay({ id, at: at(0), furthest: 60, kind: PLAY_KINDS.marked })
    viewing().recordPlay({ id, at: at(5), account: TEST_ACCOUNTS.a })
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM plays WHERE kind = ?').get(PLAY_KINDS.marked),
    ).toEqual({ n: 1 })
    expect(
      db.prepare('SELECT kind, furthest FROM plays WHERE media_id = ? ORDER BY id').all(id),
    ).toEqual([
      { kind: PLAY_KINDS.marked, furthest: 60 },
      { kind: PLAY_KINDS.played, furthest: 0 },
    ])
    db.prepare('UPDATE plays SET kind = ? WHERE kind = ? AND media_id = ?').run(
      PLAY_KINDS.cleared,
      PLAY_KINDS.played,
      id,
    )
    viewing().report({ id, position: 10, at: at(10), account: TEST_ACCOUNTS.a })
    expect(
      db.prepare('SELECT kind, furthest FROM plays WHERE media_id = ? ORDER BY id').all(id),
    ).toEqual([
      { kind: PLAY_KINDS.marked, furthest: 60 },
      { kind: PLAY_KINDS.cleared, furthest: 0 },
      { kind: PLAY_KINDS.played, furthest: 10 },
    ])
  })

  it('counts real plays in the history, takes furthest from the plays that count, and reports a mark', () => {
    const libraryId = createLibrary('kinds')
    const id = addMinute({ libraryId, name: 'film' })
    addPlay({ id, at: at(0), furthest: 60, kind: PLAY_KINDS.cleared })
    addPlay({ id, at: at(60), furthest: 10, kind: PLAY_KINDS.played })
    expect(viewing().history({ libraryId, limit: 10, account: TEST_ACCOUNTS.a })[0]).toMatchObject({
      plays: 2,
      furthest: 10,
      watched: false,
      marked: false,
    })
    addPlay({ id, at: at(120), furthest: 60, kind: PLAY_KINDS.marked })
    expect(viewing().history({ libraryId, limit: 10, account: TEST_ACCOUNTS.a })[0]).toMatchObject({
      plays: 2,
      furthest: 10,
      lastPlayedAt: at(120).toISOString(),
      watched: true,
      marked: true,
    })
    expect(watchedIds(libraryId)).toEqual([id])
  })

  it('lists a video that was only marked, with no plays, and filters by the rule', () => {
    const libraryId = createLibrary('marks-only')
    const marked = addMinute({ libraryId, name: 'marked' })
    const cleared = addMinute({ libraryId, name: 'cleared' })
    addPlay({ id: marked, at: at(0), furthest: 60, kind: PLAY_KINDS.marked })
    addPlay({ id: cleared, at: at(5), furthest: 60, kind: PLAY_KINDS.cleared })
    expect(history({ libraryId })).toEqual([
      { id: cleared, lastPlayedAt: at(5).toISOString(), plays: 1 },
      { id: marked, lastPlayedAt: at(0).toISOString(), plays: 0 },
    ])
    expect(watchedIds(libraryId)).toEqual([marked])
  })

  it('keeps one account’s spot, plays, watched videos and favourites from another', () => {
    const libraryId = createLibrary('accounts')
    const started = addMinute({ libraryId, name: 'started' })
    const finished = addMinute({ libraryId, name: 'finished' })
    viewing().report({ id: started, position: 30, at: at(0), account: TEST_ACCOUNTS.a })
    viewing().report({ id: finished, position: 60, at: at(1), account: TEST_ACCOUNTS.a })
    viewing().setFavourite({ id: started, favourite: true, account: TEST_ACCOUNTS.a })
    const seenBy = (account: AccountKey) =>
      media()
        .getMany({ ids: [started, finished], account })
        .map(({ position, favourite, watched }) => ({ position, favourite, watched }))
    const historyOf = (account: AccountKey) =>
      viewing()
        .history({ libraryId, limit: 100, account })
        .map((entry) => entry.media.id)
    const inProgressOf = (account: AccountKey) =>
      media()
        .listInProgress({ libraryId, account })
        .map((item) => item.id)

    expect(seenBy(TEST_ACCOUNTS.a)).toEqual([
      { position: 30, favourite: true, watched: false },
      { position: 0, favourite: false, watched: true },
    ])
    expect(historyOf(TEST_ACCOUNTS.a)).toEqual([finished, started])
    expect(inProgressOf(TEST_ACCOUNTS.a)).toEqual([started])
    expect(seenBy(TEST_ACCOUNTS.b)).toEqual([
      { position: 0, favourite: false, watched: false },
      { position: 0, favourite: false, watched: false },
    ])
    expect(historyOf(TEST_ACCOUNTS.b)).toEqual([])
    expect(inProgressOf(TEST_ACCOUNTS.b)).toEqual([])
    expect(media().listFavourites({ libraryId, account: TEST_ACCOUNTS.b })).toEqual([])

    viewing().report({ id: started, position: 45, at: at(2), account: TEST_ACCOUNTS.b })
    viewing().setFavourite({ id: started, favourite: false, account: TEST_ACCOUNTS.b })
    expect(seenBy(TEST_ACCOUNTS.a)[0]).toEqual({ position: 30, favourite: true, watched: false })
    expect(seenBy(TEST_ACCOUNTS.b)[0]).toEqual({ position: 45, favourite: false, watched: false })
  })

  it('never continues another account’s sitting', () => {
    const libraryId = createLibrary('two sittings')
    const id = addMinute({ libraryId, name: 'film' })
    viewing().report({ id, position: 50, at: at(0), account: TEST_ACCOUNTS.a })
    viewing().report({ id, position: 10, at: at(5), account: TEST_ACCOUNTS.b })
    const entryOf = (account: AccountKey) => viewing().history({ libraryId, limit: 10, account })[0]
    expect(entryOf(TEST_ACCOUNTS.a)).toMatchObject({ plays: 1, furthest: 50 })
    expect(entryOf(TEST_ACCOUNTS.b)).toMatchObject({ plays: 1, furthest: 10 })
    viewing().recordPlay({ id, at: at(10), account: TEST_ACCOUNTS.b })
    expect(entryOf(TEST_ACCOUNTS.a)).toMatchObject({
      plays: 1,
      lastPlayedAt: at(0).toISOString(),
    })
  })

  it('says when there is no such video, and writes nothing', () => {
    expect(viewing().report({ id: 999_999, position: 30, account: TEST_ACCOUNTS.a })).toBe(false)
    expect(viewing().recordPlay({ id: 999_999, account: TEST_ACCOUNTS.a })).toBe(false)
    expect(viewing().setFavourite({ id: 999_999, favourite: true, account: TEST_ACCOUNTS.a })).toBe(
      FAVOURITE_OUTCOMES.missing,
    )
  })

  it('marks and unmarks a favourite', () => {
    const libraryId = createLibrary('loved')
    const id = add({ libraryId, name: 'film' })
    expect(viewing().setFavourite({ id, favourite: true, account: TEST_ACCOUNTS.a })).toBe(
      FAVOURITE_OUTCOMES.done,
    )
    expect(media().get({ id, account: TEST_ACCOUNTS.a })?.favourite ?? null).toBe(true)
    expect(viewing().setFavourite({ id, favourite: false, account: TEST_ACCOUNTS.a })).toBe(
      FAVOURITE_OUTCOMES.done,
    )
    expect(media().get({ id, account: TEST_ACCOUNTS.a })?.favourite ?? null).toBe(false)
  })

  it('never marks a locked library’s video, but unmarks one', () => {
    const libraryId = libraries().create({
      name: 'hidden',
      paths: ['/hidden'],
      settings: { locked: true },
    }).id
    const id = add({ libraryId, name: 'secret' })
    expect(viewing().setFavourite({ id, favourite: true, account: TEST_ACCOUNTS.a })).toBe(
      FAVOURITE_OUTCOMES.locked,
    )
    expect(media().get({ id, account: TEST_ACCOUNTS.a })?.favourite ?? null).toBe(false)
    expect(viewing().setFavourite({ id, favourite: false, account: TEST_ACCOUNTS.a })).toBe(
      FAVOURITE_OUTCOMES.done,
    )
  })
})
