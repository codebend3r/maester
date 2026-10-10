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
