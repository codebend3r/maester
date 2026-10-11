import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MediaSort } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import { DatabaseService } from '@/db/database'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaRepository } from '@/media/mediaRepository'

type Seed = {
  name: string
  size: number
  addedAt: string
  probe: { bitrate: number; width: number; height: number } | null
}

const VIDEOS: readonly Seed[] = [
  {
    name: 'Alpha',
    size: 300,
    addedAt: '2026-01-03T00:00:00.000Z',
    probe: { bitrate: 5_000_000, width: 1920, height: 1080 },
  },
  {
    name: 'Bravo',
    size: 100,
    addedAt: '2026-01-01T00:00:00.000Z',
    probe: { bitrate: 9_000_000, width: 3840, height: 2160 },
  },
  { name: 'Charlie', size: 200, addedAt: '2026-01-02T00:00:00.000Z', probe: null },
  {
    name: 'Delta',
    size: 400,
    addedAt: '2026-01-04T00:00:00.000Z',
    probe: { bitrate: 1_000_000, width: 1280, height: 720 },
  },
]

describe('listing a library', () => {
  const state = {
    dir: '',
    libraryId: 0,
    database: null as DatabaseService | null,
    media: null as MediaRepository | null,
  }
  const media = (): MediaRepository => {
    if (!state.media) throw new Error('not set up')
    return state.media
  }
  const titles = ({ sort, seed }: { sort: MediaSort; seed?: number }): string[] =>
    media()
      .list({ libraryId: state.libraryId, sort, seed })
      .map((item) => item.title)

  beforeAll(async () => {
    state.dir = await mkdtemp(join(tmpdir(), 'raven-sort-'))
    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    state.database = database
    state.media = new MediaRepository(database)
    state.libraryId = new LibrariesRepository(database).create({ name: 'Test', paths: ['/m'] }).id
    VIDEOS.forEach((video) => {
      const id = media().insert({
        libraryId: state.libraryId,
        file: { path: `/m/${video.name}.mp4`, root: '/m', size: video.size, mtimeMs: 1 },
      })
      database.db.prepare('UPDATE media SET added_at = ? WHERE id = ?').run(video.addedAt, id)
      if (video.probe) {
        media().saveProbe({
          id,
          probe: {
            ...video.probe,
            duration: 60,
            videoCodec: 'h264',
            videoBitDepth: 8,
            hdr: false,
            audioCodec: 'aac',
            audioChannels: 2,
          },
        })
      }
    })
  })

  afterAll(async () => {
    state.database?.onModuleDestroy()
    await rm(state.dir, { recursive: true, force: true })
  })

  it.each<[MediaSort, string[]]>([
    ['title', ['Alpha', 'Bravo', 'Charlie', 'Delta']],
    ['added', ['Delta', 'Alpha', 'Charlie', 'Bravo']],
    ['oldest', ['Bravo', 'Charlie', 'Alpha', 'Delta']],
    ['largest', ['Delta', 'Alpha', 'Charlie', 'Bravo']],
    ['smallest', ['Bravo', 'Charlie', 'Alpha', 'Delta']],
    ['bitrate-high', ['Bravo', 'Alpha', 'Delta', 'Charlie']],
    ['bitrate-low', ['Delta', 'Alpha', 'Bravo', 'Charlie']],
    ['resolution-high', ['Bravo', 'Alpha', 'Delta', 'Charlie']],
    ['resolution-low', ['Delta', 'Alpha', 'Bravo', 'Charlie']],
  ])('sorts by %s', (sort, expected) => {
    expect(titles({ sort })).toEqual(expected)
  })

  it('deals the same random order for the same seed', () => {
    const first = titles({ sort: 'random', seed: 7 })
    expect(first.toSorted()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
    expect(titles({ sort: 'random', seed: 7 })).toEqual(first)
  })

  it('deals different orders for different seeds', () => {
    const orders = [1, 2, 3, 4, 5, 6].map((seed) => titles({ sort: 'random', seed }).join())
    expect(new Set(orders).size).toBeGreaterThan(1)
  })
})

describe('stored tracks', () => {
  const state = {
    dir: '',
    libraryId: 0,
    database: null as DatabaseService | null,
    media: null as MediaRepository | null,
  }
  const media = (): MediaRepository => {
    if (!state.media) throw new Error('not set up')
    return state.media
  }
  const TRACKS = {
    audio: [{ index: 0, codec: 'aac', language: 'eng', title: null, channels: 2, default: true }],
    subtitles: [],
    defaultAudio: 0,
    frameRate: 24,
  }
  const PROBE = {
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
  const add = (name: string): number =>
    media().insert({
      libraryId: state.libraryId,
      file: { path: `/m/${name}.mp4`, root: '/m', size: 100, mtimeMs: 1 },
    })

  beforeAll(async () => {
    state.dir = await mkdtemp(join(tmpdir(), 'raven-tracks-'))
    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    state.database = database
    state.media = new MediaRepository(database)
    state.libraryId = new LibrariesRepository(database).create({ name: 'Test', paths: ['/m'] }).id
  })

  afterAll(async () => {
    state.database?.onModuleDestroy()
    await rm(state.dir, { recursive: true, force: true })
  })

  it('keeps the tracks a probe found, and forgets them when the file changes', () => {
    const id = add('kept')
    media().saveProbe({ id, probe: PROBE, tracks: TRACKS })
    expect(media().storedTracks(id)).toEqual(TRACKS)
    media().markChanged({ id, size: 200, mtimeMs: 2 })
    expect(media().storedTracks(id)).toBeNull()
  })

  it('lists probed videos that have no tracks yet, and only those', () => {
    const withTracks = add('with')
    media().saveProbe({ id: withTracks, probe: PROBE, tracks: TRACKS })
    const without = add('without')
    media().saveProbe({ id: without, probe: PROBE })
    add('unprobed')
    const failed = add('failed')
    media().saveProbeError({ id: failed, error: 'No audio or video streams' })
    expect(media().idsMissingTracks(state.libraryId)).toEqual([without])
  })
})

describe('play history', () => {
  const state = {
    dir: '',
    database: null as DatabaseService | null,
    media: null as MediaRepository | null,
  }
  const media = (): MediaRepository => {
    if (!state.media) throw new Error('not set up')
    return state.media
  }
  const libraries = (): LibrariesRepository => {
    if (!state.database) throw new Error('not set up')
    return new LibrariesRepository(state.database)
  }
  const createLibrary = (name: string): number =>
    libraries().create({ name, paths: [`/${name}`] }).id
  /** A one-minute video, so seconds read straight across as sixtieths. */
  const addMinute = ({ libraryId, name }: { libraryId: number; name: string }): number => {
    const id = add({ libraryId, name })
    media().saveProbe({
      id,
      probe: {
        duration: 60,
        width: 1920,
        height: 1080,
        videoCodec: 'h264',
        videoBitDepth: 8,
        hdr: false,
        audioCodec: 'aac',
        audioChannels: 2,
        bitrate: 5_000_000,
      },
    })
    return id
  }
  const watchedIds = (libraryId: number): number[] =>
    media()
      .history({ libraryId, limit: 100, watchedOnly: true })
      .map((entry) => entry.record.id)
  const add = ({ libraryId, name }: { libraryId: number; name: string }): number =>
    media().insert({
      libraryId,
      file: { path: `/${libraryId}/${name}.mp4`, root: `/${libraryId}`, size: 100, mtimeMs: 1 },
    })
  /** A time on 10 October 2026, this many minutes after 7pm UTC. */
  const at = (minutes: number): Date => new Date(Date.UTC(2026, 9, 10, 19, minutes))
  const history = ({ libraryId, limit = 100 }: { libraryId: number; limit?: number }) =>
    media()
      .history({ libraryId, limit })
      .map((entry) => ({
        id: entry.record.id,
        lastPlayedAt: entry.lastPlayedAt,
        plays: entry.plays,
      }))

  beforeAll(async () => {
    state.dir = await mkdtemp(join(tmpdir(), 'raven-history-'))
    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    state.database = database
    state.media = new MediaRepository(database)
  })

  afterAll(async () => {
    state.database?.onModuleDestroy()
    await rm(state.dir, { recursive: true, force: true })
  })

  it('counts a video started again within half an hour as the same play', () => {
    const libraryId = createLibrary('sitting')
    const id = add({ libraryId, name: 'film' })
    media().recordPlay({ id, at: at(0) })
    media().recordPlay({ id, at: at(25) })
    expect(history({ libraryId })).toEqual([{ id, lastPlayedAt: at(25).toISOString(), plays: 1 }])
    media().recordPlay({ id, at: at(56) })
    expect(history({ libraryId })).toEqual([{ id, lastPlayedAt: at(56).toISOString(), plays: 2 }])
  })

  it('lists each played video once, by when it last played', () => {
    const libraryId = createLibrary('order')
    const first = add({ libraryId, name: 'first' })
    const second = add({ libraryId, name: 'second' })
    add({ libraryId, name: 'never' })
    media().recordPlay({ id: first, at: at(0) })
    media().recordPlay({ id: second, at: at(10) })
    media().recordPlay({ id: first, at: at(100) })
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
    media().recordPlay({ id: older, at: at(0) })
    media().recordPlay({ id: newer, at: at(5) })
    media().recordPlay({ id: add({ libraryId: otherId, name: 'elsewhere' }), at: at(9) })
    expect(history({ libraryId }).map((entry) => entry.id)).toEqual([newer, older])
    expect(history({ libraryId, limit: 1 }).map((entry) => entry.id)).toEqual([newer])
  })

  it("counts a video as watched once a play gets past its library's percentage", () => {
    const libraryId = createLibrary('threshold')
    const id = addMinute({ libraryId, name: 'minute' })
    const entry = () => media().history({ libraryId, limit: 100 })[0]
    media().recordPlay({ id, at: at(0) })
    media().notePlayedTo({ id, position: 50, at: at(1) })
    expect(entry()).toMatchObject({ furthest: 50, watched: false })
    media().notePlayedTo({ id, position: 20, at: at(2) })
    expect(entry()).toMatchObject({ furthest: 50, watched: false })
    media().notePlayedTo({ id, position: 55, at: at(3) })
    expect(entry()).toMatchObject({ furthest: 55, watched: true, plays: 1 })
  })

  it('moves the bar when the library changes its percentage', () => {
    const libraryId = createLibrary('lenient')
    const id = addMinute({ libraryId, name: 'minute' })
    media().notePlayedTo({ id, position: 30, at: at(0) })
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
    media().notePlayedTo({ id: finished, position: 60, at: at(0) })
    media().notePlayedTo({ id: started, position: 10, at: at(5) })
    expect(history({ libraryId }).map((entry) => entry.id)).toEqual([started, finished])
    expect(watchedIds(libraryId)).toEqual([finished])
  })

  it('never counts a video it cannot measure as watched', () => {
    const libraryId = createLibrary('unprobed')
    const id = add({ libraryId, name: 'unknown length' })
    media().notePlayedTo({ id, position: 5000, at: at(0) })
    expect(media().history({ libraryId, limit: 100 })[0]).toMatchObject({ watched: false })
  })

  it('forgets the plays of a video that leaves the library', () => {
    const libraryId = createLibrary('gone')
    const id = add({ libraryId, name: 'deleted' })
    media().recordPlay({ id, at: at(0) })
    media().removeMany([id])
    expect(history({ libraryId })).toEqual([])
  })
})
