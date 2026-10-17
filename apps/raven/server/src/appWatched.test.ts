import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  type ApiClient,
  type ItemChild,
  type LibraryInput,
  MAX_WATCH_TARGETS,
  type WatchTarget,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { DatabaseService } from '@/db/database'
import { localEpisode, localSeason } from '@/metadata/localItems'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { BLANK_ITEM, type FetchedItem } from '@/metadata/tmdbClient'
import { ScannerService } from '@/scanner/scannerService'
import { NOT_WATCHING, adminCookie, cookieSet, cookies, testConfig } from '@/test/app'
import { encodeClip } from '@/test/clips'
import { apiFor } from '@/test/server'

const PIN = '3001'

/** As a browser with the admin lock on, which is who marks: the route is for viewers. */
describe('marking videos watched', () => {
  const state = {
    root: '',
    admin: '',
    open: 0,
    private: 0,
    ids: new Map<string, number>(),
    items: new Map<string, number>(),
    app: null as NestFastifyApplication | null,
  }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const at = (...parts: string[]) => join(state.root, 'media', ...parts)
  const id = (name: string): number => state.ids.get(name) ?? -1
  const item = (name: string): number => state.items.get(name) ?? -1
  /** A browser holding `cookie`, or none: the admin lock is on for it either way. */
  const api = (cookie?: string): ApiClient => apiFor({ app: app(), cookie })
  const admin = (): ApiClient => apiFor({ app: app(), cookie: state.admin })
  const put = ({ body, cookie }: { body: unknown; cookie?: string }) =>
    app().inject({
      method: 'PUT',
      url: '/api/watched',
      payload: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    })
  const setWatched = ({
    watched,
    targets,
    cookie,
  }: {
    watched: boolean
    targets: WatchTarget[]
    cookie?: string
  }) => api(cookie).setWatched({ watched, targets })
  const watchedFile = async ({
    name,
    cookie,
  }: {
    name: string
    cookie?: string
  }): Promise<boolean> => (await api(cookie).getMedia(id(name))).watched
  const childrenOf = async (name: string): Promise<ItemChild[]> =>
    (await api().getItem(item(name))).children
  const createLibrary = async (input: LibraryInput): Promise<number> => {
    const created = await admin().createLibrary(input)
    await app().get(ScannerService).whenIdle(created.id)
    return created.id
  }
  const unlock = async (): Promise<string> =>
    cookieSet(
      await app().inject({ method: 'POST', url: '/api/lock/unlock', payload: { pin: PIN } }),
    )

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-watched-'))
    await encodeClip({ path: at('Open', 'Heat (1995).mp4'), seconds: 2 })
    await Promise.all(
      [
        ['Open', 'Ronin (1998).mp4'],
        ['Open', 'Andor S01E01.mp4'],
        ['Open', 'Andor S01E02.mp4'],
        ['Open', 'Mixed S01E02.mp4'],
      ].map(([folder = '', name = '']) =>
        copyFile(at('Open', 'Heat (1995).mp4'), at(folder, name)),
      ),
    )
    await encodeClip({ path: at('Private', 'Lesson One.mp4'), seconds: 2 })
    await copyFile(at('Private', 'Lesson One.mp4'), at('Private', 'Mixed S01E01.mp4'))
    state.app = await createApp({
      config: {
        ...testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
        libraryPin: PIN,
      },
      quiet: true,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    state.admin = await adminCookie(state.app)
    state.open = await createLibrary({ name: 'Open', paths: [at('Open')] })
    state.private = await createLibrary({
      name: 'Tutorials',
      paths: [at('Private')],
      settings: { locked: true },
    })
    const metadata = app().get(MetadataRepository)
    app()
      .get(DatabaseService)
      .db.prepare<[], { id: number; file_name: string }>('SELECT id, file_name FROM media')
      .all()
      .forEach((row) => state.ids.set(row.file_name, row.id))
    const movie = ({ title, tmdbId }: { title: string; tmdbId: string }): void => {
      state.items.set(
        title,
        metadata.save({
          item: { ...BLANK_ITEM, type: 'movie', tmdbId, number: null, title },
        }),
      )
      metadata.link({ mediaIds: [id(`${title}.mp4`)], itemIds: [item(title)] })
    }
    movie({ title: 'Heat (1995)', tmdbId: '949' })
    movie({ title: 'Ronin (1998)', tmdbId: '2000' })
    movie({ title: 'Lesson One', tmdbId: '7001' })
    const show = ({
      title,
      tmdbId,
      files: names,
    }: {
      title: string
      tmdbId: string
      files: string[]
    }) => {
      const fetched: FetchedItem = {
        ...localSeason({ showTmdbId: tmdbId, number: 1 }),
        type: 'show',
        tmdbId,
        number: null,
        title,
      }
      const showId = metadata.save({ item: fetched })
      const season = metadata.saveSeason({
        showId,
        number: 1,
        season: localSeason({ showTmdbId: tmdbId, number: 1 }),
        episodes: names.map((_, position) => ({
          ...localEpisode({
            showTmdbId: tmdbId,
            season: 1,
            number: position + 1,
            title: `Episode ${position + 1}`,
          }),
          tmdbId: `${tmdbId}-1-${position + 1}`,
        })),
      })
      names.forEach((name, position) =>
        metadata.link({
          mediaIds: [id(name)],
          itemIds: [season.episodes.get(position + 1) ?? -1],
        }),
      )
      state.items.set(title, showId)
      state.items.set(`${title} season`, season.id)
    }
    show({
      title: 'Andor',
      tmdbId: '700',
      files: ['Andor S01E01.mp4', 'Andor S01E02.mp4'],
    })
    // Its first episode is only in the locked library.
    show({
      title: 'Mixed',
      tmdbId: '701',
      files: ['Mixed S01E01.mp4', 'Mixed S01E02.mp4'],
    })
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('answers 204 to a viewer with the admin lock on, and marks the file', async () => {
    const response = await put({
      body: { watched: true, targets: [{ kind: 'media', id: id('Ronin (1998).mp4') }] },
    })
    expect(response.statusCode).toBe(204)
    expect(await watchedFile({ name: 'Ronin (1998).mp4' })).toBe(true)
    expect(await watchedFile({ name: 'Heat (1995).mp4' })).toBe(false)
  })

  it('puts a mark in the history, and takes it out again', async () => {
    const [entry] = await api().listHistory({ libraryId: state.open, limit: 10 })
    expect(entry).toMatchObject({ plays: 0, furthest: 0, watched: true, marked: true })
    expect(entry?.media.id).toBe(id('Ronin (1998).mp4'))
    await setWatched({ watched: false, targets: [{ kind: 'media', id: id('Ronin (1998).mp4') }] })
    expect(await watchedFile({ name: 'Ronin (1998).mp4' })).toBe(false)
    expect(await api().listHistory({ libraryId: state.open, limit: 10 })).toEqual([])
  })

  it('clears the resume spot of what it marks, and the file is no longer in progress', async () => {
    const heat = id('Heat (1995).mp4')
    await api().saveProgress({ id: heat, position: 1 })
    expect((await api().getMedia(heat)).position).toBe(1)
    await setWatched({
      watched: true,
      targets: [{ kind: 'item', id: item('Heat (1995)'), libraryId: null }],
    })
    expect(await api().getMedia(heat)).toMatchObject({ watched: true, position: 0 })
    await setWatched({
      watched: false,
      targets: [{ kind: 'item', id: item('Heat (1995)'), libraryId: state.open }],
    })
    expect(await watchedFile({ name: 'Heat (1995).mp4' })).toBe(false)
  })

  it('marks every episode under a show, and counts them on the season', async () => {
    await setWatched({
      watched: true,
      targets: [{ kind: 'item', id: item('Andor'), libraryId: null }],
    })
    const season = await api().getItem(item('Andor'))
    expect(
      season.children.map((child) => (child.type === 'season' ? child.watchedCount : -1)),
    ).toEqual([2])
    const episodes = await childrenOf('Andor season')
    expect(episodes.map((child) => (child.type === 'episode' ? child.watched : null))).toEqual([
      true,
      true,
    ])
    expect(await api().nextEpisode(item('Andor'))).toBeNull()
    await setWatched({
      watched: false,
      targets: [{ kind: 'item', id: item('Andor season'), libraryId: null }],
    })
    expect((await api().nextEpisode(item('Andor')))?.id).toBe(id('Andor S01E01.mp4'))
  })

  it('skips the targets in a locked library without saying so', async () => {
    const lesson = id('Lesson One.mp4')
    const response = await put({
      body: {
        watched: true,
        targets: [
          { kind: 'media', id: lesson },
          { kind: 'item', id: item('Lesson One'), libraryId: null },
          { kind: 'item', id: item('Lesson One'), libraryId: state.private },
          { kind: 'media', id: 987_654 },
        ],
      },
    })
    expect(response.statusCode).toBe(204)
    const pin = await unlock()
    expect(await watchedFile({ name: 'Lesson One.mp4', cookie: cookies(state.admin, pin) })).toBe(
      false,
    )
    await setWatched({
      watched: true,
      targets: [{ kind: 'media', id: lesson }],
      cookie: cookies(state.admin, pin),
    })
    expect(await watchedFile({ name: 'Lesson One.mp4', cookie: cookies(state.admin, pin) })).toBe(
      true,
    )
    await setWatched({
      watched: false,
      targets: [{ kind: 'media', id: lesson }],
      cookie: cookies(state.admin, pin),
    })
  })

  it('finds a show’s next episode among the libraries the browser may see only', async () => {
    const pin = await unlock()
    const unlocked = cookies(state.admin, pin)
    expect((await api().nextEpisode(item('Mixed')))?.id).toBe(id('Mixed S01E02.mp4'))
    expect((await api(unlocked).nextEpisode(item('Mixed')))?.id).toBe(id('Mixed S01E01.mp4'))
  })

  it('picks a random episode among the libraries the browser may see only', async () => {
    const pin = await unlock()
    const unlocked = cookies(state.admin, pin)
    const rolls = Array.from({ length: 12 }, () => undefined)
    const locked = await Promise.all(rolls.map(() => api().randomEpisode(item('Mixed'))))
    expect(new Set(locked.map((media) => media?.id))).toEqual(new Set([id('Mixed S01E02.mp4')]))
    const open = await Promise.all(rolls.map(() => api(unlocked).randomEpisode(item('Mixed'))))
    open.forEach((media) =>
      expect([id('Mixed S01E01.mp4'), id('Mixed S01E02.mp4')]).toContain(media?.id),
    )
    expect(await api().randomEpisode(item('Heat (1995)'))).toBeNull()
  })

  it('counts only the libraries the browser may see', async () => {
    const pin = await unlock()
    const unlocked = cookies(state.admin, pin)
    await setWatched({
      watched: true,
      targets: [{ kind: 'item', id: item('Mixed'), libraryId: null }],
      cookie: unlocked,
    })
    const episodes = (cookie?: string) =>
      api(cookie)
        .getItem(item('Mixed season'))
        .then(({ children }) =>
          children.map((child) => (child.type === 'episode' ? child.watched : null)),
        )
    expect(await episodes(unlocked)).toEqual([true, true])
    expect(await episodes()).toEqual([true])
  })

  it('refuses a body that is not a change, and an empty or oversized list of targets', async () => {
    const target = { kind: 'media', id: id('Heat (1995).mp4') }
    const refused = await Promise.all([
      put({ body: {} }),
      put({ body: undefined }),
      put({ body: { watched: true, targets: [] } }),
      put({
        body: {
          watched: true,
          targets: Array.from({ length: MAX_WATCH_TARGETS + 1 }, () => target),
        },
      }),
    ])
    expect(refused.map((response) => response.statusCode)).toEqual([400, 400, 400, 400])
    const full = await put({
      body: { watched: false, targets: Array.from({ length: MAX_WATCH_TARGETS }, () => target) },
    })
    expect(full.statusCode).toBe(204)
  })

  it('still holds back the writes only the admin makes', async () => {
    const refused = await app().inject({
      method: 'POST',
      url: '/api/libraries',
      payload: { name: 'Sneaky', paths: [at('Open')] },
    })
    expect(refused.statusCode).toBe(403)
  })
})
