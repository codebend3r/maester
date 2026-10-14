import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { isLibrary } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { DatabaseService } from '@/db/database'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { NOT_WATCHING, adminCookie, testConfig } from '@/test/app'
import { encodeClip } from '@/test/clips'
import { fakeTmdb } from '@/test/fakeTmdb'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

/**
 * A Movies library whose search for Heat waits until let go, so its matching
 * pass is still busy when the scan ends: what the scan leaves can be told
 * apart from what the pass leaves.
 */
describe("the query planner's statistics", () => {
  const tmdb = fakeTmdb({ movies: [{ id: 949, title: 'Heat', released: '1995-12-15' }] })
  const state: {
    root: string
    app: NestFastifyApplication | null
    library: number
    letGo: () => void
  } = { root: '', app: null, library: 0, letGo: () => undefined }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  /** `sqlite_stat1` for `table`'s indexes, by index name: none before it was analyzed. */
  const statisticsOf = (table: string): Record<string, string> => {
    const { db } = app().get(DatabaseService)
    const isAnalyzed = !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_stat1'").get()
    if (!isAnalyzed) return {}
    return Object.fromEntries(
      db
        .prepare<[string], { idx: string; stat: string }>(
          'SELECT idx, stat FROM sqlite_stat1 WHERE tbl = ? AND idx IS NOT NULL',
        )
        .all(table)
        .map(({ idx, stat }) => [idx, stat]),
    )
  }

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-statistics-'))
    const media = join(state.root, 'Movies')
    await Promise.all([
      encodeClip({ path: join(media, 'Heat (1995)', 'Heat (1995).mp4'), seconds: 1 }),
      encodeClip({ path: join(media, 'Ronin (1998)', 'Ronin (1998).mp4'), seconds: 1 }),
    ])
    state.app = await createApp({
      config: {
        ...testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
        tmdbApiToken: 'test-token',
      },
      quiet: true,
      metadataFetch: tmdb.fetch,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    const admin = await adminCookie(state.app)
    state.letGo = tmdb.hold('heat')
    const created = await app().inject({
      method: 'POST',
      url: '/api/libraries',
      headers: { cookie: admin },
      payload: { name: 'Films', paths: [media], settings: { kind: 'movies' } },
    })
    const library: unknown = created.json()
    if (!isLibrary(library)) throw new Error(`Unexpected body: ${created.body}`)
    state.library = library.id
    await app().get(ScannerService).whenIdle(state.library)
  })

  afterAll(async () => {
    state.letGo()
    await state.app?.get(MetadataService).whenIdle()
    await state.app?.get(ThumbnailService).whenIdle()
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('cover the videos a scan indexed once it ends, while matching still runs', () => {
    expect(statisticsOf('media')).toMatchObject({ media_library_title: '2 2 1' })
    expect(statisticsOf('items')).toEqual({})
  })

  it('cover the movies a matching pass stored once it ends', async () => {
    state.letGo()
    await app().get(MetadataService).whenIdle()
    expect(statisticsOf('items')).toEqual({
      items_parent: '1 1 1',
      sqlite_autoindex_items_1: '1 1 1',
    })
    expect(statisticsOf('media_items')).toEqual({
      media_items_item: '1 1',
      sqlite_autoindex_media_items_1: '1 1 1',
    })
  })
})
