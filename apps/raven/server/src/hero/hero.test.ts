import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { HOME_SHELF_TYPES, type Hero, isHero, isHeroPicks, isLibrary } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { MetadataService } from '@/metadata/metadataService'
import { ScannerService } from '@/scanner/scannerService'
import { ThumbnailService } from '@/thumbnails/thumbnailService'
import { adminCookie, cookieSet, cookies, injectAs, testConfig } from '@/test/app'
import { MediaIndex } from '@/media/mediaIndex'
import { apiFor } from '@/test/server'
import { encodeClip } from '@/test/clips'
import { fakeTmdb } from '@/test/fakeTmdb'

const HERO_COUNT = 2

const shape = <T>({
  response,
  guard,
}: {
  response: { rawPayload: Buffer; json: () => unknown }
  guard: (value: unknown) => value is T
}): T => {
  const body: unknown = response.json()
  if (!guard(body)) throw new Error(`Unexpected body: ${response.rawPayload.toString()}`)
  return body
}

/** The titles a hero shows, in order. */
const titlesOf = (hero: Hero): string[] =>
  hero.map(
    (entry) => (entry.type === HOME_SHELF_TYPES.media ? entry.media.item?.title : null) ?? '',
  )

describe('home hero', () => {
  const tmdb = fakeTmdb({
    movies: [
      { id: 603, title: 'The Matrix', released: '1999-03-31' },
      { id: 949, title: 'Heat', released: '1995-12-15' },
      { id: 680, title: 'Pulp Fiction', released: '1994-09-10' },
      { id: 861072, title: "Don't Make Me Go", released: '2022-06-13' },
      { id: 999, title: 'Vault Thing', released: '2023-05-05' },
    ],
  })
  const state: {
    root: string
    admin: string
    app: NestFastifyApplication | null
    library: number
    vault: number
  } = { root: '', admin: '', app: null, library: 0, vault: 0 }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const hero = async (): Promise<Hero> =>
    shape({ response: await app().inject({ method: 'GET', url: '/api/home/hero' }), guard: isHero })
  const pick = ({
    itemId,
    isShown,
    asAdmin = true,
  }: {
    itemId: number
    isShown: boolean
    asAdmin?: boolean
  }) =>
    asAdmin
      ? injectAs({ app: app(), cookie: state.admin })({
          method: 'PUT',
          url: '/api/hero/picks',
          payload: { itemId, isShown },
        })
      : app().inject({ method: 'PUT', url: '/api/hero/picks', payload: { itemId, isShown } })
  /** The item ids by title, read off the library's own listing. */
  const idOf = async (title: string): Promise<number> => {
    const entries = await app()
      .inject({ method: 'GET', url: `/api/libraries/${state.library}/media` })
      .then((response) => response.json())
    const found = Array.isArray(entries)
      ? entries.find((entry) => entry?.item?.title === title)?.item?.id
      : undefined
    if (typeof found !== 'number') throw new Error(`No ${title}`)
    return found
  }

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-hero-'))
    const media = join(state.root, 'Movies')
    await Promise.all([
      encodeClip({ path: join(media, 'The Matrix (1999)', 'The Matrix (1999).mp4'), seconds: 1 }),
      encodeClip({ path: join(media, 'Heat (1995) {tmdb-949}', 'Heat.mp4'), seconds: 1 }),
      encodeClip({
        path: join(media, 'Pulp Fiction (1994)', 'Pulp Fiction (1994).mp4'),
        seconds: 1,
      }),
      encodeClip({
        path: join(media, 'Dont Make Me (2022)', "Don't Make Me Go (2022).mp4"),
        seconds: 1,
      }),
    ])
    await encodeClip({
      path: join(state.root, 'Vault', 'Vault Thing (2023)', 'Vault Thing (2023).mp4'),
      seconds: 30,
    })
    state.app = await createApp({
      config: {
        ...testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
        tmdbApiToken: 'test-token',
        heroCount: HERO_COUNT,
        libraryPin: '3001',
      },
      quiet: true,
      metadataFetch: tmdb.fetch,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    state.admin = await adminCookie(state.app)
    const created = shape({
      response: await injectAs({ app: state.app, cookie: state.admin })({
        method: 'POST',
        url: '/api/libraries',
        payload: { name: 'Films', paths: [media], settings: { kind: 'movies' } },
      }),
      guard: isLibrary,
    })
    state.library = created.id
    const vault = shape({
      response: await injectAs({ app: state.app, cookie: state.admin })({
        method: 'POST',
        url: '/api/libraries',
        payload: {
          name: 'Vault',
          paths: [join(state.root, 'Vault')],
          settings: { kind: 'movies', locked: true },
        },
      }),
      guard: isLibrary,
    })
    state.vault = vault.id
    await state.app.get(ScannerService).whenIdle(state.vault)
    await state.app.get(ScannerService).whenIdle(state.library)
    await state.app.get(MetadataService).whenIdle()
    await state.app.get(ThumbnailService).whenIdle()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('shows the most recently released titles, not the last added, up to HERO_COUNT', async () => {
    expect(titlesOf(await hero())).toEqual(["Don't Make Me Go", 'The Matrix'])
  })

  it('lets only the admin read or change the picks', async () => {
    const itemId = await idOf('Heat')
    expect((await pick({ itemId, isShown: true, asAdmin: false })).statusCode).toBe(403)
    expect((await app().inject({ method: 'GET', url: '/api/hero/picks' })).statusCode).toBe(403)
  })

  it('shows only what the admin picked, in the order picked, and the defaults again once none is', async () => {
    const heat = await idOf('Heat')
    const pulp = await idOf('Pulp Fiction')
    await pick({ itemId: pulp, isShown: true })
    const added = shape({
      response: await pick({ itemId: heat, isShown: true }),
      guard: isHeroPicks,
    })
    expect(added).toEqual({ itemIds: [pulp, heat], limit: HERO_COUNT })
    expect(titlesOf(await hero())).toEqual(['Pulp Fiction', 'Heat'])

    await pick({ itemId: pulp, isShown: false })
    await pick({ itemId: heat, isShown: false })
    expect(titlesOf(await hero())).toEqual(["Don't Make Me Go", 'The Matrix'])
  })

  it('leaves a library out of the hero, picks included, while it is not included', async () => {
    const heat = await idOf('Heat')
    const setInHero = (inHero: boolean) =>
      injectAs({ app: app(), cookie: state.admin })({
        method: 'PUT',
        url: `/api/libraries/${state.library}/hero`,
        payload: { inHero },
      })
    await pick({ itemId: heat, isShown: true })

    expect((await setInHero(false)).statusCode).toBe(200)
    expect(await hero()).toEqual([])
    expect((await pick({ itemId: await idOf('Pulp Fiction'), isShown: true })).statusCode).toBe(400)

    expect((await setInHero(true)).statusCode).toBe(200)
    expect(titlesOf(await hero())).toEqual(['Heat'])
    await pick({ itemId: heat, isShown: false })
  })

  it('refuses a pick past the cap, and a title that is no movie or show here', async () => {
    const [heat, pulp, matrix] = await Promise.all([
      idOf('Heat'),
      idOf('Pulp Fiction'),
      idOf('The Matrix'),
    ])
    await pick({ itemId: heat, isShown: true })
    await pick({ itemId: pulp, isShown: true })
    expect((await pick({ itemId: matrix, isShown: true })).statusCode).toBe(409)
    expect((await pick({ itemId: 987654, isShown: true })).statusCode).toBe(400)
    await pick({ itemId: heat, isShown: false })
    await pick({ itemId: pulp, isShown: false })
  })
  describe('a locked library', () => {
    const unlockCookie = async (): Promise<string> =>
      cookieSet(
        await app().inject({
          method: 'POST',
          url: '/api/lock/unlock',
          payload: { pin: '3001' },
          headers: { cookie: state.admin },
        }),
      )
    /**
     * A browser by its cookies: the admin's, the PIN's, both, or neither. The PIN's alone is the
     * admin lock back on while the unlock still stands.
     */
    const as = ({ isAdmin, pin }: { isAdmin: boolean; pin: string | null }) => ({
      cookie: cookies(isAdmin ? state.admin : undefined, pin ?? undefined),
    })
    const setInHero = ({ cookie, inHero }: { cookie: string; inHero: boolean }) =>
      app().inject({
        method: 'PUT',
        url: `/api/libraries/${state.vault}/hero`,
        payload: { inHero },
        headers: { cookie },
      })
    const heroFor = async (browser: { cookie: string }): Promise<string[]> =>
      titlesOf(
        shape({
          response: await app().inject({ method: 'GET', url: '/api/home/hero', headers: browser }),
          guard: isHero,
        }),
      )

    it('starts out of the hero, and cannot be put in, unlocked or not', async () => {
      const library = shape({
        response: await app().inject({
          method: 'GET',
          url: `/api/libraries/${state.vault}`,
          headers: { cookie: state.admin },
        }),
        guard: isLibrary,
      })
      expect(library.settings.inHero).toBe(false)
      const pin = await unlockCookie()
      expect((await setInHero({ cookie: state.admin, inHero: true })).statusCode).toBe(423)
      expect(
        (await setInHero({ cookie: cookies(state.admin, pin), inHero: true })).statusCode,
      ).toBe(400)
    })

    it('never shows in the hero, for the admin unlocked or for anyone else', async () => {
      const pin = await unlockCookie()
      expect(await heroFor(as({ isAdmin: true, pin }))).not.toContain('Vault Thing')
      expect(await heroFor(as({ isAdmin: true, pin: null }))).not.toContain('Vault Thing')
      expect(await heroFor(as({ isAdmin: false, pin }))).not.toContain('Vault Thing')
      expect(await heroFor(as({ isAdmin: false, pin: null }))).not.toContain('Vault Thing')
    })

    it('is in progress for the admin alone, even with the PIN entered', async () => {
      const pin = await unlockCookie()
      const [video = 0] = app().get(MediaIndex).idsForLibrary(state.vault)
      await apiFor({ app: app(), cookie: cookies(state.admin, pin) }).saveProgress({
        id: video,
        position: 10,
        audio: null,
      })
      const inProgress = async (browser: { cookie: string }): Promise<number[]> =>
        (await apiFor({ app: app(), cookie: browser.cookie }).getHome()).inProgress.map(
          ({ media }) => media.id,
        )

      expect(await inProgress(as({ isAdmin: true, pin }))).toContain(video)
      expect(await inProgress(as({ isAdmin: false, pin }))).not.toContain(video)
      expect(await inProgress(as({ isAdmin: false, pin: null }))).not.toContain(video)
    })

    it('drops out of the hero, and stays out, the moment it is locked', async () => {
      const pin = await unlockCookie()
      const send = injectAs({ app: app(), cookie: cookies(state.admin, pin) })
      const paths = [join(state.root, 'Vault')]
      const lockedAs = (locked: boolean) =>
        send({
          method: 'PUT',
          url: `/api/libraries/${state.vault}`,
          payload: { name: 'Vault', paths, settings: { locked } },
        })
      await lockedAs(false)
      expect(
        (await setInHero({ cookie: cookies(state.admin, pin), inHero: true })).statusCode,
      ).toBe(200)
      expect(await heroFor(as({ isAdmin: true, pin }))).toContain('Vault Thing')

      await lockedAs(true)

      const library = shape({
        response: await send({ method: 'GET', url: `/api/libraries/${state.vault}` }),
        guard: isLibrary,
      })
      expect(library.settings).toMatchObject({ locked: true, inHero: false })
      expect(await heroFor(as({ isAdmin: true, pin }))).not.toContain('Vault Thing')
    })
  })
})
