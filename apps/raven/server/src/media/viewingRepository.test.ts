import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { FAVOURITE_OUTCOMES } from '@/media/favouriteOutcomes'
import { MediaIndex } from '@/media/mediaIndex'
import { ViewingRepository } from '@/media/viewingRepository'
import { testDatabase } from '@/test/database'
import { repositories } from '@/test/repositories'

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

describe('play history', () => {
  const database = testDatabase('raven-history-')
  const media = () => repositories(database.get()).media
  const viewing = () => new ViewingRepository(database.get(), media())
  const index = () => new MediaIndex(database.get())
  const libraries = () => new LibrariesRepository(database.get())
  const createLibrary = (name: string): number =>
    libraries().create({ name, paths: [`/${name}`] }).id
  const add = ({ libraryId, name }: { libraryId: number; name: string }): number =>
    index().insert({
      libraryId,
      kind: 'other',
      file: { path: `/${libraryId}/${name}.mp4`, root: `/${libraryId}`, size: 100, mtimeMs: 1 },
    })
  /** A one-minute video, so seconds read straight across as sixtieths. */
  const addMinute = ({ libraryId, name }: { libraryId: number; name: string }): number => {
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
      .history({ libraryId, limit: 100, watchedOnly: true })
      .map((entry) => entry.media.id)
  /** A time on 10 October 2026, this many minutes after 7pm UTC. */
  const at = (minutes: number): Date => new Date(Date.UTC(2026, 9, 10, 19, minutes))
  const history = ({ libraryId, limit = 100 }: { libraryId: number; limit?: number }) =>
    viewing()
      .history({ libraryId, limit })
      .map((entry) => ({
        id: entry.media.id,
        lastPlayedAt: entry.lastPlayedAt,
        plays: entry.plays,
      }))
  const positionOf = (id: number): number => media().get(id)?.position ?? -1

  beforeAll(database.open)
  afterAll(database.close)

  it('counts a video started again within half an hour as the same play', () => {
    const libraryId = createLibrary('sitting')
    const id = add({ libraryId, name: 'film' })
    viewing().recordPlay({ id, at: at(0) })
    viewing().recordPlay({ id, at: at(25) })
    expect(history({ libraryId })).toEqual([{ id, lastPlayedAt: at(25).toISOString(), plays: 1 }])
    viewing().recordPlay({ id, at: at(56) })
    expect(history({ libraryId })).toEqual([{ id, lastPlayedAt: at(56).toISOString(), plays: 2 }])
  })

  it('lists each played video once, by when it last played', () => {
    const libraryId = createLibrary('order')
    const first = add({ libraryId, name: 'first' })
    const second = add({ libraryId, name: 'second' })
    add({ libraryId, name: 'never' })
    viewing().recordPlay({ id: first, at: at(0) })
    viewing().recordPlay({ id: second, at: at(10) })
    viewing().recordPlay({ id: first, at: at(100) })
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
    viewing().recordPlay({ id: older, at: at(0) })
    viewing().recordPlay({ id: newer, at: at(5) })
    viewing().recordPlay({ id: add({ libraryId: otherId, name: 'elsewhere' }), at: at(9) })
    expect(history({ libraryId }).map((entry) => entry.id)).toEqual([newer, older])
    expect(history({ libraryId, limit: 1 }).map((entry) => entry.id)).toEqual([newer])
  })

  it("counts a video as watched once a play gets past its library's percentage", () => {
    const libraryId = createLibrary('threshold')
    const id = addMinute({ libraryId, name: 'minute' })
    const entry = () => viewing().history({ libraryId, limit: 100 })[0]
    viewing().recordPlay({ id, at: at(0) })
    viewing().report({ id, position: 50, at: at(1) })
    expect(entry()).toMatchObject({ furthest: 50, watched: false })
    viewing().report({ id, position: 20, at: at(2) })
    expect(entry()).toMatchObject({ furthest: 50, watched: false })
    viewing().report({ id, position: 57, at: at(3) })
    expect(entry()).toMatchObject({ furthest: 57, watched: true, plays: 1 })
  })

  it('moves the bar when the library changes its percentage', () => {
    const libraryId = createLibrary('lenient')
    const id = addMinute({ libraryId, name: 'minute' })
    viewing().report({ id, position: 30, at: at(0) })
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
    viewing().report({ id: finished, position: 60, at: at(0) })
    viewing().report({ id: started, position: 10, at: at(5) })
    expect(history({ libraryId }).map((entry) => entry.id)).toEqual([started, finished])
    expect(watchedIds(libraryId)).toEqual([finished])
  })

  it('never counts a video it cannot measure as watched', () => {
    const libraryId = createLibrary('unprobed')
    const id = add({ libraryId, name: 'unknown length' })
    viewing().report({ id, position: 5000, at: at(0) })
    expect(viewing().history({ libraryId, limit: 100 })[0]).toMatchObject({ watched: false })
  })

  it('forgets the plays of a video that leaves the library', () => {
    const libraryId = createLibrary('gone')
    const id = add({ libraryId, name: 'deleted' })
    viewing().recordPlay({ id, at: at(0) })
    index().remove([id])
    expect(history({ libraryId })).toEqual([])
  })

  it('saves the spot to resume from with the play, and starting a play keeps it', () => {
    const libraryId = createLibrary('resume')
    const id = addMinute({ libraryId, name: 'film' })
    expect(viewing().report({ id, position: 30, at: at(0) })).toBe(true)
    expect(positionOf(id)).toBe(30)
    viewing().recordPlay({ id, at: at(90) })
    expect(positionOf(id)).toBe(30)
    viewing().report({ id, position: 2, at: at(91) })
    expect(positionOf(id)).toBe(0)
  })

  it('keeps the history but no spot while its library saves no progress', () => {
    const libraryId = createLibrary('forgetful')
    libraries().update({
      id: libraryId,
      input: { name: 'forgetful', paths: ['/forgetful'], settings: { saveProgress: false } },
    })
    const id = addMinute({ libraryId, name: 'film' })
    viewing().report({ id, position: 30, at: at(0) })
    expect(positionOf(id)).toBe(0)
    expect(viewing().history({ libraryId, limit: 100 })[0]).toMatchObject({ furthest: 30 })
  })

  it('clears the spot at the library’s watched percentage, and not before', () => {
    const libraryId = createLibrary('threshold-spot')
    const id = addMinute({ libraryId, name: 'minute' })
    viewing().report({ id, position: 56, at: at(0) })
    expect(positionOf(id)).toBe(56)
    viewing().report({ id, position: 57, at: at(1) })
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
    viewing().report({ id: early, position: 29, at: at(0) })
    expect(positionOf(early)).toBe(29)
    viewing().report({ id: early, position: 30, at: at(1) })
    expect(positionOf(early)).toBe(0)
    const strict = createLibrary('strict')
    libraries().update({
      id: strict,
      input: { name: 'strict', paths: ['/strict'], settings: { watchedPercent: 100 } },
    })
    const late = addMinute({ libraryId: strict, name: 'late' })
    viewing().report({ id: late, position: 59, at: at(0) })
    expect(positionOf(late)).toBe(59)
  })

  it('keeps the spots of a library that saves no progress, even past the threshold', () => {
    const libraryId = createLibrary('keeps-spots')
    const id = addMinute({ libraryId, name: 'film' })
    viewing().report({ id, position: 30, at: at(0) })
    libraries().update({
      id: libraryId,
      input: { name: 'keeps-spots', paths: ['/keeps-spots'], settings: { saveProgress: false } },
    })
    viewing().report({ id, position: 60, at: at(1) })
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
    db.prepare(
      "INSERT INTO plays (media_id, played_at, furthest, kind) VALUES (?, ?, 60, 'marked')",
    ).run(id, at(0).toISOString())
    viewing().recordPlay({ id, at: at(5) })
    expect(db.prepare("SELECT COUNT(*) AS n FROM plays WHERE kind = 'marked'").get()).toEqual({
      n: 1,
    })
    expect(
      db.prepare('SELECT kind, furthest FROM plays WHERE media_id = ? ORDER BY id').all(id),
    ).toEqual([
      { kind: 'marked', furthest: 60 },
      { kind: 'played', furthest: 0 },
    ])
    db.prepare("UPDATE plays SET kind = 'cleared' WHERE kind = 'played' AND media_id = ?").run(id)
    viewing().report({ id, position: 10, at: at(10) })
    expect(
      db.prepare('SELECT kind, furthest FROM plays WHERE media_id = ? ORDER BY id').all(id),
    ).toEqual([
      { kind: 'marked', furthest: 60 },
      { kind: 'cleared', furthest: 0 },
      { kind: 'played', furthest: 10 },
    ])
  })

  it('counts real plays in the history, takes furthest from the plays that count, and reports a mark', () => {
    const libraryId = createLibrary('kinds')
    const id = addMinute({ libraryId, name: 'film' })
    const insert = database
      .get()
      .db.prepare('INSERT INTO plays (media_id, played_at, furthest, kind) VALUES (?, ?, ?, ?)')
    insert.run(id, at(0).toISOString(), 60, 'cleared')
    insert.run(id, at(60).toISOString(), 10, 'played')
    expect(viewing().history({ libraryId, limit: 10 })[0]).toMatchObject({
      plays: 2,
      furthest: 10,
      watched: false,
      marked: false,
    })
    insert.run(id, at(120).toISOString(), 60, 'marked')
    expect(viewing().history({ libraryId, limit: 10 })[0]).toMatchObject({
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
    const insert = database
      .get()
      .db.prepare('INSERT INTO plays (media_id, played_at, furthest, kind) VALUES (?, ?, ?, ?)')
    insert.run(marked, at(0).toISOString(), 60, 'marked')
    insert.run(cleared, at(5).toISOString(), 60, 'cleared')
    expect(history({ libraryId })).toEqual([
      { id: cleared, lastPlayedAt: at(5).toISOString(), plays: 1 },
      { id: marked, lastPlayedAt: at(0).toISOString(), plays: 0 },
    ])
    expect(watchedIds(libraryId)).toEqual([marked])
  })

  it('says when there is no such video, and writes nothing', () => {
    expect(viewing().report({ id: 999_999, position: 30 })).toBe(false)
    expect(viewing().recordPlay({ id: 999_999 })).toBe(false)
    expect(viewing().setFavourite({ id: 999_999, favourite: true })).toBe(
      FAVOURITE_OUTCOMES.missing,
    )
  })

  it('marks and unmarks a favourite', () => {
    const libraryId = createLibrary('loved')
    const id = add({ libraryId, name: 'film' })
    expect(viewing().setFavourite({ id, favourite: true })).toBe(FAVOURITE_OUTCOMES.done)
    expect(media().get(id)?.favourite).toBe(true)
    expect(viewing().setFavourite({ id, favourite: false })).toBe(FAVOURITE_OUTCOMES.done)
    expect(media().get(id)?.favourite).toBe(false)
  })

  it('never marks a locked library’s video, but unmarks one', () => {
    const libraryId = libraries().create({
      name: 'hidden',
      paths: ['/hidden'],
      settings: { locked: true },
    }).id
    const id = add({ libraryId, name: 'secret' })
    expect(viewing().setFavourite({ id, favourite: true })).toBe(FAVOURITE_OUTCOMES.locked)
    expect(media().get(id)?.favourite).toBe(false)
    expect(viewing().setFavourite({ id, favourite: false })).toBe(FAVOURITE_OUTCOMES.done)
  })
})
