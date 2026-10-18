import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isItemDetails,
  isItemImageOptions,
  isLibrary,
  isMatchCandidateList,
  isMediaItem,
  isMediaList,
  ITEM_TYPES,
  LIBRARY_KINDS,
  MATCH_STATES,
} from '@raven/core'
import { describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { adminCookie, injectAs, testConfig } from '@/test/app'
import { encodeClip } from '@/test/clips'
import { fakeTmdb } from '@/test/fakeTmdb'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

const DOCUMENTARY = {
  id: 216581,
  key: 'tv:216581',
  title: 'Dahmer on Dahmer: A Serial Killer Speaks',
  query: 'Dahmer on Dahmer',
  file: 'Dahmer on Dahmer A Serial Killer Speaks (2017) WEBDL-1080p.mp4',
} as const

const checked = <T>({
  value,
  guard,
}: {
  value: unknown
  guard: (value: unknown) => value is T
}): T => {
  if (!guard(value)) throw new Error(`Unexpected response: ${JSON.stringify(value)}`)
  return value
}

describe('TV documentaries in movie libraries', () => {
  it('searches, matches, saves and refreshes Dahmer on Dahmer without confusing its TV id with a movie id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'raven-documentary-movies-'))
    const media = join(root, 'Documentaries')
    const tmdb = fakeTmdb({
      movies: [{ id: DOCUMENTARY.id, title: 'Unrelated Movie', released: '2000-01-01' }],
      shows: [
        {
          id: DOCUMENTARY.id,
          title: DOCUMENTARY.title,
          first: '2017-11-11',
          alternativeTitles: [DOCUMENTARY.query],
          genreIds: [99, 80],
          seasons: { 1: [{ number: 1, title: 'Part One', aired: '2017-11-11' }] },
        },
      ],
    })
    const config = {
      ...testConfig({ dataDir: join(root, 'data'), mediaDir: root }),
      tmdbApiToken: 'test-token',
    }
    const start = async () => {
      const app = await createApp({ config, quiet: true, metadataFetch: tmdb.fetch })
      await app.init()
      await app.getHttpAdapter().getInstance().ready()
      const admin = injectAs({ app, cookie: await adminCookie(app) })
      return { app, admin }
    }
    const running = { current: await start() }
    try {
      await Promise.all([
        encodeClip({ path: join(media, DOCUMENTARY.file), seconds: 1 }),
        encodeClip({ path: join(media, 'Unrelated Movie (2000).mp4'), seconds: 1 }),
      ])
      const library = checked({
        value: (
          await running.current.admin({
            method: 'POST',
            url: '/api/libraries',
            payload: {
              name: 'Documentaries',
              paths: [media],
              settings: { kind: LIBRARY_KINDS.documentaries },
            },
          })
        ).json(),
        guard: isLibrary,
      })
      await running.current.app.get(ScannerService).whenIdle(library.id)
      await running.current.app.get(MetadataService).whenIdle()
      await running.current.app.get(ThumbnailService).whenIdle()
      const files = checked({
        value: (
          await running.current.app.inject({
            method: 'GET',
            url: `/api/libraries/${library.id}/media`,
          })
        ).json(),
        guard: isMediaList,
      })
      const documentary = files.find((file) => file.fileName === DOCUMENTARY.file)
      const unrelated = files.find((file) => file.fileName !== DOCUMENTARY.file)
      expect(documentary).toMatchObject({
        match: MATCH_STATES.matched,
        item: { type: ITEM_TYPES.movie, title: DOCUMENTARY.title },
      })
      const fileId = documentary?.id
      const itemId = documentary?.item?.id
      if (fileId == null || itemId == null) throw new Error('Documentary was not matched')
      expect(unrelated?.item?.id).not.toBe(itemId)
      const details = async () =>
        checked({
          value: (
            await running.current.app.inject({ method: 'GET', url: `/api/items/${itemId}` })
          ).json(),
          guard: isItemDetails,
        })
      expect(await details()).toMatchObject({
        type: ITEM_TYPES.movie,
        tmdbId: DOCUMENTARY.key,
        runtime: null,
      })
      const candidates = checked({
        value: (
          await running.current.admin({
            method: 'GET',
            url: `/api/match/search?type=movie&query=${encodeURIComponent(DOCUMENTARY.query)}&year=2017&mediaId=${fileId}&libraryId=${library.id}`,
          })
        ).json(),
        guard: isMatchCandidateList,
      })
      expect(candidates).toMatchObject([
        { tmdbId: DOCUMENTARY.key, title: DOCUMENTARY.title, year: 2017 },
      ])
      expect(candidates[0]?.confidence).toBeGreaterThan(0)
      const matched = checked({
        value: (
          await running.current.admin({
            method: 'PUT',
            url: `/api/media/${fileId}/match`,
            payload: { tmdbId: candidates[0]?.tmdbId },
          })
        ).json(),
        guard: isMediaItem,
      })
      expect(matched).toMatchObject({ match: MATCH_STATES.manual, item: { id: itemId } })
      await running.current.app.close()
      running.current = await start()
      await running.current.app.get(MetadataService).whenIdle()
      expect(await details()).toMatchObject({ tmdbId: DOCUMENTARY.key, title: DOCUMENTARY.title })
      const persisted = checked({
        value: (
          await running.current.app.inject({ method: 'GET', url: `/api/media/${fileId}` })
        ).json(),
        guard: isMediaItem,
      })
      expect(persisted).toMatchObject({ match: MATCH_STATES.manual, item: { id: itemId } })
      const refreshed = await running.current.admin({
        method: 'POST',
        url: `/api/items/${itemId}/refresh`,
      })
      expect(refreshed.statusCode).toBe(200)
      expect(await details()).toMatchObject({ type: ITEM_TYPES.movie, tmdbId: DOCUMENTARY.key })
      const images = checked({
        value: (
          await running.current.admin({ method: 'GET', url: `/api/items/${itemId}/images` })
        ).json(),
        guard: isItemImageOptions,
      })
      expect(images.poster.length).toBeGreaterThan(0)
      expect(
        tmdb.state.calls.some((url) => new URL(url).pathname === `/3/tv/${DOCUMENTARY.id}/images`),
      ).toBe(true)
      expect(tmdb.state.calls.some((url) => new URL(url).pathname.includes('/season/'))).toBe(false)
    } finally {
      await running.current.app.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
