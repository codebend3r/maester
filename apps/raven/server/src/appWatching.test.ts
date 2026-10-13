import { copyFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { type ApiClient, type MediaItem, parseServerEvent } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { ScannerService } from '@/scanner/scannerService'
import { adminCookie, eventually, testConfig } from '@/test/app'
import { encodeClip } from '@/test/clips'
import { apiFor } from '@/test/server'

/** As a browser with the admin lock off, so the library can be added and edited. */
describe('refreshing a library as its folders change', () => {
  const state: {
    root: string
    media: string
    admin: string
    libraryId: number
    app: NestFastifyApplication | null
  } = { root: '', media: '', admin: '', libraryId: 0, app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const api = (): ApiClient => apiFor({ app: app(), cookie: state.admin })
  const at = (...parts: string[]) => join(state.media, ...parts)
  const listMedia = (): Promise<MediaItem[]> =>
    api().listMedia({ libraryId: state.libraryId, sort: 'changed' })
  const fileNames = (items: MediaItem[]): string[] => items.map((item) => item.fileName).toSorted()

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-refresh-'))
    state.media = join(state.root, 'media')
    await encodeClip({ path: at('Heat (1995).mp4'), seconds: 2 })
    state.app = await createApp({
      config: testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
      quiet: true,
      watch: { quietMs: 100 },
    })
    await state.app.listen(0, '127.0.0.1')
    state.admin = await adminCookie(state.app)
    const created = await api().createLibrary({ name: 'Watched', paths: [state.media] })
    state.libraryId = created.id
    await app().get(ScannerService).whenIdle(created.id)
    // The watch is set up a moment after the library is saved.
    await new Promise((resolve) => setTimeout(resolve, 300))
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('takes in a video added to a folder under it', async () => {
    await mkdir(at('Ronin (1998)'))
    await copyFile(at('Heat (1995).mp4'), at('Ronin (1998)', 'Ronin (1998).mp4'))
    const items = await eventually({
      read: listMedia,
      check: (current) => current.some((item) => item.fileName === 'Ronin (1998).mp4'),
    })
    expect(items.find((item) => item.fileName === 'Ronin (1998).mp4')?.folder).toBe('Ronin (1998)')
  })

  it('follows a renamed video: the same video, moved up Recently changed', async () => {
    const before = (await listMedia()).find((item) => item.fileName === 'Heat (1995).mp4')
    await api().setFavourite({ id: before?.id ?? -1, favourite: true })
    await rename(at('Heat (1995).mp4'), at('Heat (1995) 1080p.mp4'))
    const items = await eventually({
      read: listMedia,
      check: (current) => current.some((item) => item.fileName === 'Heat (1995) 1080p.mp4'),
    })
    expect(fileNames(items)).toEqual(['Heat (1995) 1080p.mp4', 'Ronin (1998).mp4'])
    expect(items[0]).toMatchObject({ id: before?.id, favourite: true, title: 'Heat (1995) 1080p' })
    expect((items[0]?.changedAt ?? '') > (before?.changedAt ?? '')).toBe(true)
    expect(items[0]?.addedAt).toBe(before?.addedAt)
  })

  it('drops a video deleted from its folder', async () => {
    await rm(at('Ronin (1998)'), { recursive: true })
    const items = await eventually({
      read: listMedia,
      check: (current) => current.length === 1,
    })
    expect(fileNames(items)).toEqual(['Heat (1995) 1080p.mp4'])
  })

  it('tells a listening client which library changed', async () => {
    const abort = new AbortController()
    // A real request over the port: an event stream stays open, which `inject` cannot.
    const response = await fetch(`${await app().getUrl()}${api().eventsUrl()}`, {
      signal: abort.signal,
    })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body?.getReader()
    await copyFile(at('Heat (1995) 1080p.mp4'), at('Heat (1995) copy.mp4'))
    const read = async (text: string): Promise<string> => {
      const chunk = await reader?.read()
      const next = text + new TextDecoder().decode(chunk?.value)
      return next.includes('data:') || chunk?.done ? next : read(next)
    }
    const message = await read('')
    abort.abort()
    const data = message.split('\n').find((line) => line.startsWith('data:')) ?? ''
    expect(parseServerEvent(data.slice('data:'.length).trim())).toEqual({
      type: 'library',
      libraryId: state.libraryId,
    })
  })

  it('leaves the library alone once it no longer refreshes automatically', async () => {
    await api().updateLibrary({
      id: state.libraryId,
      input: { name: 'Watched', paths: [state.media], settings: { autoRefresh: false } },
    })
    const before = fileNames(await listMedia())
    await copyFile(at('Heat (1995) 1080p.mp4'), at('Unwatched.mp4'))
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(fileNames(await listMedia())).toEqual(before)
  })
})

/** As a browser with the admin lock off, so the library can be added and edited. */
describe('a library whose folders cannot be watched', () => {
  const state: {
    root: string
    admin: string
    libraryId: number
    app: NestFastifyApplication | null
    /** Every watch asked for, and whether it should fail. */
    watches: string[]
    failing: boolean
  } = { root: '', admin: '', libraryId: 0, app: null, watches: [], failing: true }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const api = (): ApiClient => apiFor({ app: app(), cookie: state.admin })
  const media = () => join(state.root, 'media')
  const listMedia = (): Promise<MediaItem[]> => api().listMedia({ libraryId: state.libraryId })

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-unwatched-'))
    await encodeClip({ path: join(media(), 'Heat (1995).mp4'), seconds: 2 })
    state.app = await createApp({
      config: testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
      quiet: true,
      watch: {
        fallbackScanMs: 100,
        watchFolder: ({ root, onError }) => {
          state.watches.push(root)
          if (state.failing)
            onError(new Error('ENOSPC: System limit for number of file watchers reached'))
          return { close: () => undefined }
        },
      },
    })
    await state.app.init()
    state.admin = await adminCookie(state.app)
    const created = await api().createLibrary({ name: 'Unwatched', paths: [media()] })
    state.libraryId = created.id
    await app().get(ScannerService).whenIdle(created.id)
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('is scanned on a timer instead, so new videos still turn up', async () => {
    await copyFile(join(media(), 'Heat (1995).mp4'), join(media(), 'Ronin (1998).mp4'))
    const items = await eventually({
      read: listMedia,
      check: (current) => current.length === 2,
    })
    expect(items.map((item) => item.fileName).toSorted()).toEqual([
      'Heat (1995).mp4',
      'Ronin (1998).mp4',
    ])
  })

  it('is watched again once a library is saved', async () => {
    const before = state.watches.length
    state.failing = false
    await api().updateLibrary({
      id: state.libraryId,
      input: { name: 'Unwatched again', paths: [media()] },
    })
    expect(state.watches.length).toBe(before + 1)
  })
})
