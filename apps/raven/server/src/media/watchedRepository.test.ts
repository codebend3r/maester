import type { ItemType, WatchTarget } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import type { Viewer } from '@/lock/lockService'
import { MediaIndex } from '@/media/mediaIndex'
import { ViewingRepository } from '@/media/viewingRepository'
import { WatchedCards } from '@/media/watchedCards'
import { WatchedRepository } from '@/media/watchedRepository'
import { BLANK_ITEM, type FetchedItem } from '@/metadata/tmdbClient'
import { testDatabase } from '@/test/database'
import { repositories } from '@/test/repositories'

const TRACKS = { audio: [], subtitles: [], defaultAudio: null, frameRate: 24 }

const EVERYONE: Viewer = {
  listsLibrary: () => true,
  seesLibrary: () => true,
  seesItem: () => true,
  sees: () => true,
}

/** A browser that sees every library but `hidden`. */
const hiding = (hidden: number): Viewer => ({
  ...EVERYONE,
  seesLibrary: (libraryId) => libraryId !== hidden,
})

const NOW = new Date(Date.UTC(2026, 9, 15, 12, 0))

describe('marking cards watched', () => {
  const database = testDatabase('raven-mark-watched-')
  const state = { libraryId: 0, otherId: 0, saveless: 0 }
  const stores = () => repositories(database.get())
  const viewing = () => new ViewingRepository(database.get(), stores().media)
  const index = () => new MediaIndex(database.get())
  const cards = () => new WatchedCards(database.get(), stores().metadata)
  const watching = () => new WatchedRepository(database.get())
  const rows = <T>(sql: string, ...params: unknown[]): T[] =>
    database
      .get()
      .db.prepare<unknown[], T>(sql)
      .all(...params)

  const addFile = ({
    libraryId,
    name,
    height = 1080,
    duration = 60,
  }: {
    libraryId: number
    name: string
    height?: number
    duration?: number | null
  }): number => {
    const id = index().insert({
      libraryId,
      kind: 'other',
      file: { path: `/${libraryId}/${name}.mkv`, root: `/${libraryId}`, size: 100, mtimeMs: 1 },
    })
    if (duration != null) {
      index().saveProbe({
        id,
        probe: {
          duration,
          width: (height * 16) / 9,
          height,
          videoCodec: 'h264',
          videoBitDepth: 8,
          hdr: false,
          audioCodec: 'aac',
          audioChannels: 2,
          bitrate: 5_000_000,
        },
        tracks: TRACKS,
      })
    }
    return id
  }
  const fetched = ({
    type,
    tmdbId,
    title,
    number = null,
  }: {
    type: ItemType
    tmdbId: string
    title: string
    number?: number | null
  }): FetchedItem => ({ ...BLANK_ITEM, type, tmdbId, number, title })
  /** A movie with a file for each height, the tallest best. */
  const addMovie = ({
    title,
    heights,
    libraryId = state.libraryId,
  }: {
    title: string
    heights: readonly number[]
    libraryId?: number
  }): { itemId: number; ids: number[] } => {
    const itemId = stores().metadata.save({
      item: fetched({ type: 'movie', tmdbId: title, title }),
    })
    const ids = heights.map((height) => addFile({ libraryId, name: `${title} ${height}p`, height }))
    stores().metadata.link({ mediaIds: ids, itemIds: [itemId] })
    return { itemId, ids }
  }
  /** A show of `count` episodes; the files link by `fileIn`. */
  const addShow = ({ title, count }: { title: string; count: number }) => {
    const { metadata } = stores()
    const showId = metadata.save({ item: fetched({ type: 'show', tmdbId: title, title }) })
    const seasonId = metadata.save({
      item: fetched({ type: 'season', tmdbId: `${title}-1`, title, number: 1 }),
      parentId: showId,
    })
    const episodeIds = Array.from({ length: count }, (_, at) =>
      metadata.save({
        item: fetched({
          type: 'episode',
          tmdbId: `${title}-1-${at + 1}`,
          title: `Episode ${at + 1}`,
          number: at + 1,
        }),
        parentId: seasonId,
      }),
    )
    return { showId, seasonId, episodeIds }
  }
  const linkFile = ({
    name,
    itemIds,
    ...options
  }: { name: string; itemIds: number[] } & Partial<Parameters<typeof addFile>[0]>): number => {
    const id = addFile({ libraryId: state.libraryId, name, ...options })
    stores().metadata.link({ mediaIds: [id], itemIds })
    return id
  }
  const set = ({
    watched,
    targets,
    viewer = EVERYONE,
  }: {
    watched: boolean
    targets: WatchTarget[]
    viewer?: Viewer
  }): void => {
    watching().set({ cards: cards().resolve({ targets, viewer }), watched, at: NOW })
  }
  const file = (id: number): WatchTarget => ({ kind: 'media', id })
  const item = ({
    id,
    libraryId = null,
  }: {
    id: number
    libraryId?: number | null
  }): WatchTarget => ({
    kind: 'item',
    id,
    libraryId,
  })
  const playsOf = (id: number) =>
    rows<{ kind: string; furthest: number; played_at: string }>(
      'SELECT kind, furthest, played_at FROM plays WHERE media_id = ? ORDER BY id',
      id,
    )
  const watchedOf = (id: number): boolean => stores().media.get(id)?.watched ?? false
  const spotOf = (id: number): number | undefined =>
    rows<{ position: number }>('SELECT position FROM playback_progress WHERE media_id = ?', id)[0]
      ?.position

  beforeAll(async () => {
    await database.open()
    const libraries = new LibrariesRepository(database.get())
    state.libraryId = libraries.create({ name: 'Movies', paths: ['/1'] }).id
    state.otherId = libraries.create({ name: 'Locked', paths: ['/2'] }).id
    state.saveless = libraries.create({
      name: 'Forgetful',
      paths: ['/3'],
      settings: { saveProgress: false },
    }).id
  })

  afterAll(database.close)

  it('writes one mark on a card’s best file and clears the spots of every file on it', () => {
    const { ids } = addMovie({ title: 'Heat', heights: [720, 2160, 1080] })
    const [small = -1, best = -1, middle = -1] = ids
    viewing().report({ id: small, position: 30 })
    viewing().report({ id: middle, position: 20 })
    set({ watched: true, targets: [file(small)] })
    expect(playsOf(best)).toEqual([{ kind: 'marked', furthest: 60, played_at: NOW.toISOString() }])
    expect(playsOf(small).map((play) => play.kind)).toEqual(['played'])
    expect([spotOf(small), spotOf(middle)]).toEqual([undefined, undefined])
    expect(ids.map(watchedOf)).toEqual([true, true, true])
  })

  it('leaves a card that is watched already alone, with its spot and no second mark', () => {
    const { ids } = addMovie({ title: 'Ronin', heights: [1080, 720] })
    const [best = -1, other = -1] = ids
    set({ watched: true, targets: [file(best)] })
    viewing().report({ id: other, position: 20, at: new Date(NOW.getTime() + 3_600_000) })
    set({ watched: true, targets: [file(other), file(best)] })
    expect(playsOf(best).map((play) => play.kind)).toEqual(['marked'])
    expect(playsOf(other).map((play) => play.kind)).toEqual(['played'])
    expect(spotOf(other)).toBe(20)
  })

  it('writes one History row for a three-version movie named three times', () => {
    const { ids, itemId } = addMovie({ title: 'Alexander', heights: [2160, 1080, 720] })
    set({ watched: true, targets: [...ids.map(file), item({ id: itemId })] })
    expect(
      rows(
        'SELECT id FROM plays WHERE media_id IN (SELECT value FROM json_each(?))',
        JSON.stringify(ids),
      ),
    ).toHaveLength(1)
  })

  it('marks a file no one has probed, with no length to record', () => {
    const id = addFile({ libraryId: state.libraryId, name: 'Unprobed', duration: null })
    set({ watched: true, targets: [file(id)] })
    expect(playsOf(id)).toEqual([{ kind: 'marked', furthest: 0, played_at: NOW.toISOString() }])
    expect(watchedOf(id)).toBe(true)
  })

  it('clears the spot even where the library saves no progress', () => {
    const id = addFile({ libraryId: state.saveless, name: 'Kept' })
    database
      .get()
      .db.prepare(
        'INSERT INTO playback_progress (media_id, position, updated_at) VALUES (?, 12, ?)',
      )
      .run(id, NOW.toISOString())
    set({ watched: true, targets: [file(id)] })
    expect(spotOf(id)).toBeUndefined()
  })

  it('marks the cards of a split movie apart', () => {
    const { ids } = addMovie({ title: 'Cuts', heights: [1080, 720] })
    const [theatrical = -1, cut = -1] = ids
    database.get().db.prepare("UPDATE media SET split = 'cut:Final Cut' WHERE id = ?").run(cut)
    set({ watched: true, targets: [file(cut)] })
    expect([watchedOf(theatrical), watchedOf(cut)]).toEqual([false, true])
    expect(playsOf(theatrical)).toEqual([])
  })

  it('marks a two-episode file once for both its episodes', () => {
    const { episodeIds } = addShow({ title: 'Doubled', count: 2 })
    const shared = linkFile({ name: 'Doubled S01E01-E02', itemIds: episodeIds })
    set({ watched: true, targets: episodeIds.map((id) => item({ id })) })
    expect(playsOf(shared).map((play) => play.kind)).toEqual(['marked'])
    set({ watched: false, targets: [item({ id: episodeIds[1] ?? -1 })] })
    expect(episodeIds.map((id) => stores().media.watchedEpisodes([id]).length)).toEqual([0, 0])
  })

  it('marks a whole show, season by season, one mark for each episode', () => {
    const { showId, episodeIds } = addShow({ title: 'Andor', count: 3 })
    const files = episodeIds.map((id, at) => linkFile({ name: `Andor ${at}`, itemIds: [id] }))
    viewing().report({ id: files[1] ?? -1, position: 10 })
    set({ watched: true, targets: [item({ id: showId })] })
    expect(
      files.map((id) => playsOf(id).filter((play) => play.kind === PLAY_KINDS.marked).length),
    ).toEqual([1, 1, 1])
    expect(spotOf(files[1] ?? -1)).toBeUndefined()
  })

  it('unwatches by deleting marks, setting real plays aside and clearing spots', () => {
    const { ids } = addMovie({ title: 'Collateral', heights: [1080, 720] })
    const [best = -1, other = -1] = ids
    set({ watched: true, targets: [file(best)] })
    viewing().report({ id: other, position: 60, at: new Date(NOW.getTime() + 3_600_000) })
    viewing().report({ id: best, position: 20, at: new Date(NOW.getTime() + 7_200_000) })
    expect(playsOf(best).map((play) => play.kind)).toEqual(['marked', 'played'])
    set({ watched: false, targets: [file(best)] })
    expect(watchedOf(best)).toBe(false)
    expect(playsOf(best).map((play) => play.kind)).toEqual(['cleared'])
    expect(playsOf(other).map((play) => play.kind)).toEqual(['cleared'])
    expect([spotOf(best), spotOf(other)]).toEqual([undefined, undefined])
  })

  it('leaves the plays of a card in progress alone when it is unwatched already', () => {
    const { showId, episodeIds } = addShow({ title: 'Season', count: 2 })
    const [done = -1, started = -1] = episodeIds.map((id, at) =>
      linkFile({ name: `Season ${at}`, itemIds: [id] }),
    )
    viewing().report({ id: done, position: 60, at: NOW })
    viewing().report({ id: started, position: 20, at: NOW })
    set({ watched: false, targets: [item({ id: showId })] })
    expect(playsOf(done).map((play) => play.kind)).toEqual(['cleared'])
    expect(playsOf(started).map((play) => play.kind)).toEqual(['played'])
    expect(spotOf(started)).toBe(20)
  })

  it('counts a later play again after an unwatch', () => {
    const { ids } = addMovie({ title: 'Seen Twice', heights: [1080] })
    const id = ids[0] ?? -1
    viewing().report({ id, position: 60, at: NOW })
    set({ watched: false, targets: [file(id)] })
    expect(watchedOf(id)).toBe(false)
    viewing().report({ id, position: 59, at: new Date(NOW.getTime() + 60_000) })
    expect(playsOf(id).map((play) => play.kind)).toEqual(['cleared', 'played'])
    expect(watchedOf(id)).toBe(true)
  })

  it('skips a library the viewer may not see, and a target that names nothing', () => {
    const hidden = addMovie({ title: 'Hidden', heights: [1080], libraryId: state.otherId })
    const shown = addMovie({ title: 'Shown', heights: [1080] })
    const viewer = hiding(state.otherId)
    set({
      watched: true,
      targets: [
        file(hidden.ids[0] ?? -1),
        item({ id: hidden.itemId }),
        item({ id: hidden.itemId, libraryId: state.otherId }),
        file(987_654),
        item({ id: 987_654 }),
        file(shown.ids[0] ?? -1),
      ],
      viewer,
    })
    expect(watchedOf(hidden.ids[0] ?? -1)).toBe(false)
    expect(watchedOf(shown.ids[0] ?? -1)).toBe(true)
  })

  it('marks an item in one library only when asked for that library', () => {
    const { itemId } = addMovie({ title: 'Twice Over', heights: [1080] })
    const there = addFile({ libraryId: state.otherId, name: 'Twice Over elsewhere' })
    stores().metadata.link({ mediaIds: [there], itemIds: [itemId] })
    set({ watched: true, targets: [item({ id: itemId, libraryId: state.otherId })] })
    expect(watchedOf(there)).toBe(true)
    expect(
      stores()
        .media.forItem(itemId)
        .filter((each) => each.libraryId === state.libraryId)
        .map((each) => each.watched),
    ).toEqual([false])
  })
})
