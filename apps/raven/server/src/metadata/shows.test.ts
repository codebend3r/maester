import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  ITEM_TYPES,
  type ItemDetails,
  type MediaItem,
  type ShowListing,
  isHome,
  isFavouriteTitles,
  isItemDetails,
  isItemImageOptions,
  isLibrary,
  isMediaItem,
  isMediaList,
  isShowListing,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { DatabaseService } from '@/db/database'
import { ItemRefresher } from '@/metadata/itemRefresher'
import { MetadataService } from '@/metadata/metadataService'
import { ScoreSweep } from '@/metadata/scoreSweep'
import { ScannerService } from '@/scanner/scannerService'
import { type InjectOptions, adminCookie, injectAs, testConfig } from '@/test/app'
import { encodeClip, encodeImage } from '@/test/clips'
import { FAKE_JPEG, fakeTmdb } from '@/test/fakeTmdb'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

type Injected = {
  statusCode: number
  rawPayload: Buffer
  headers: Record<string, unknown>
  json: () => unknown
}

type ShapeProps<T> = {
  response: Injected
  guard: (value: unknown) => value is T
}

const shape = <T>({ response, guard }: ShapeProps<T>): T => {
  const body: unknown = response.json()
  if (!guard(body)) throw new Error(`Unexpected body: ${response.rawPayload.toString()}`)
  return body
}

/** As a browser with the admin lock off, so files can be matched. */
describe('TV show metadata', () => {
  const tmdb = fakeTmdb({
    movies: [],
    shows: [
      {
        id: 95396,
        title: 'Severance',
        first: '2022-02-18',
        tvdbId: '371980',
        seasons: {
          1: [
            { number: 1, title: 'Good News About Hell', aired: '2022-02-18' },
            { number: 2, title: 'Half Loop', aired: '2022-02-18' },
            { number: 3, title: 'In Perpetuity', aired: '2022-02-25' },
          ],
          2: [{ number: 1, title: 'Hello, Ms. Cobel', aired: '2025-01-17' }],
        },
      },
      {
        id: 60622,
        title: 'Fargo',
        first: '2014-04-15',
        last: '2024-01-16',
        seasons: {
          2: [
            { number: 9, title: 'The Castle', aired: '2015-12-07' },
            { number: 10, title: 'Palindrome', aired: '2015-12-14' },
          ],
        },
      },
      {
        id: 247718,
        title: 'Murderbot',
        first: '2025-05-16',
        seasons: { 1: [{ number: 1, title: 'FreeCommerce', aired: '2025-05-16' }] },
      },
      {
        id: 126308,
        title: 'Shōgun',
        first: '2024-02-27',
        seasons: { 1: [{ number: 1, title: 'Anjin', aired: '2024-02-27' }] },
      },
      {
        id: 209867,
        title: 'Frieren',
        first: '2023-09-29',
        seasons: {
          1: [
            { number: 1, title: 'The Journey’s End', aired: '2023-09-29' },
            { number: 2, title: 'It Didn’t Have to Be Magic', aired: '2023-09-29' },
          ],
        },
      },
    ],
  })
  const state: {
    root: string
    media: string
    data: string
    admin: string
    app: NestFastifyApplication | null
    library: number
  } = { root: '', media: '', data: '', admin: '', app: null, library: 0 }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  /** A request by hand as the admin, for a route the admin lock holds back. */
  const asAdmin = (options: InjectOptions) => injectAs({ app: app(), cookie: state.admin })(options)
  const settle = async () => {
    await app().get(ScannerService).whenIdle(state.library)
    await app().get(MetadataService).whenIdle()
    await app().get(ThumbnailService).whenIdle()
  }
  const shows = async (query = ''): Promise<ShowListing> =>
    shape({
      response: await app().inject({
        method: 'GET',
        url: `/api/libraries/${state.library}/shows${query}`,
      }),
      guard: isShowListing,
    })
  const media = async (): Promise<MediaItem[]> =>
    shape({
      response: await app().inject({
        method: 'GET',
        url: `/api/libraries/${state.library}/media`,
      }),
      guard: isMediaList,
    })
  const byFile = async (fileName: string): Promise<MediaItem> => {
    const found = (await media()).find((item) => item.fileName === fileName)
    if (!found) throw new Error(`No ${fileName}`)
    return found
  }
  const item = async (id: number | undefined): Promise<ItemDetails> =>
    shape({
      response: await app().inject({ method: 'GET', url: `/api/items/${id}` }),
      guard: isItemDetails,
    })
  const showNamed = async (title: string) => {
    const found = (await shows()).shows.find((entry) => entry.show.title === title)
    if (!found) throw new Error(`No show ${title}`)
    return found
  }
  const rescan = async () => {
    await asAdmin({ method: 'POST', url: `/api/libraries/${state.library}/scan` })
    await settle()
  }

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-shows-'))
    state.media = join(state.root, 'TV')
    state.data = join(state.root, 'data')
    const severance = join(state.media, 'Severance (2022)')
    await Promise.all([
      encodeClip({
        path: join(severance, 'Season 01', 'Severance - S01E01 - Good News About Hell.mp4'),
        seconds: 2,
      }),
      encodeClip({
        path: join(severance, 'Season 01', 'Severance - S01E02 - Half Loop.mp4'),
        seconds: 2,
      }),
      encodeClip({
        path: join(severance, 'Season 02', 'Severance - S02E01 - Hello, Ms. Cobel.mp4'),
        seconds: 1,
      }),
      encodeClip({ path: join(severance, 'Featurettes', 'Making Of.mp4'), seconds: 1 }),
      encodeImage({ path: join(severance, 'poster.jpg') }),
      encodeImage({
        path: join(severance, 'Season 01', 'Severance - S01E01 - Good News About Hell-thumb.jpg'),
        size: '300x169',
      }),
      encodeClip({ path: join(state.media, 'Fargo', 'Fargo.S02E09E10.1080p.mp4'), seconds: 1 }),
      encodeClip({
        path: join(
          state.media,
          'Frieren',
          'Season 01',
          'Frieren - (0012) S01E012 - A Real Hero.mp4',
        ),
        seconds: 1,
      }),
      encodeClip({
        path: join(state.media, 'Muderbot', 'Season 1', 'Murderbot - S01E01 - FreeCommerce.mp4'),
        seconds: 1,
      }),
      encodeClip({
        // Named as a Mac's SMB mount gives it: the macron as a combining mark.
        path: join(
          state.media,
          'Sho\u0304gun (2024)',
          'Season 1',
          'Sho\u0304gun - S01E01 - Anjin.mp4',
        ),
        seconds: 1,
      }),
      encodeClip({
        path: join(state.media, 'Unknown Show', 'Season 1', 'Unknown Show - S01E01.mp4'),
        seconds: 1,
      }),
    ])
    state.app = await createApp({
      config: {
        ...testConfig({ dataDir: state.data, mediaDir: state.root }),
        tmdbApiToken: 'test-token',
      },
      quiet: true,
      metadataFetch: tmdb.fetch,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    state.admin = await adminCookie(state.app)
    const created = shape({
      response: await asAdmin({
        method: 'POST',
        url: '/api/libraries',
        payload: { name: 'TV', paths: [state.media], settings: { kind: 'shows' } },
      }),
      guard: isLibrary,
    })
    state.library = created.id
    await settle()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('lists the library as shows, with episode counts, years and the unmatched after', async () => {
    const listing = await shows()
    expect(
      listing.shows.map((entry) => [
        entry.show.title,
        entry.episodes,
        entry.show.year,
        entry.endedYear,
      ]),
    ).toEqual([
      ['Fargo', 2, 2014, 2024],
      ['Frieren', 1, 2023, null],
      ['Murderbot', 1, 2025, null],
      ['Severance', 3, 2022, null],
      ['Shōgun', 1, 2024, null],
    ])
    expect(listing.unmatched.map((entry) => entry.fileName)).toEqual(['Unknown Show - S01E01.mp4'])
    expect(listing.shows.every((entry) => entry.show.posterVersion != null)).toBe(true)
  })

  // Before the Anime shows case: it counts TMDB's calls across the file, and that case searches again.
  it('searches once per show folder, and fetches each season once', () => {
    const searches = tmdb.state.calls.filter((url) => url.includes('/search/tv'))
    expect(searches.filter((url) => url.includes('Severance'))).toHaveLength(1)
    expect(tmdb.state.calls.filter((url) => url.includes('/tv/95396/season/1'))).toHaveLength(1)
  })

  it('matches again as an Anime shows library, listed and shelved as its shows', async () => {
    const setKind = async (kind: string) => {
      await asAdmin({
        method: 'PUT',
        url: `/api/libraries/${state.library}`,
        payload: { name: 'TV', paths: [state.media], settings: { kind } },
      })
      await settle()
    }
    const before = await shows()
    const asked = tmdb.state.calls.length
    await setKind('animeShows')
    // None of these shows is animation, so each search falls through to the same pick.
    expect(await shows()).toEqual(before)
    const searched = tmdb.state.calls.length
    expect(searched).toBeGreaterThan(asked)
    const home = shape({
      response: await app().inject({ method: 'GET', url: '/api/home' }),
      guard: isHome,
    })
    expect(home.shelves.find((shelf) => shelf.libraryId === state.library)?.type).toBe('shows')
    await setKind('shows')
    expect(await shows()).toEqual(before)
    expect(tmdb.state.calls.length).toBeGreaterThan(searched)
  })

  it('matches a misspelt folder by the name its files carry', async () => {
    const episode = await byFile('Murderbot - S01E01 - FreeCommerce.mp4')
    expect(episode.match).toBe('matched')
    expect(episode.item).toMatchObject({ show: { title: 'Murderbot' }, season: 1, episode: 1 })
    const asked = tmdb.state.calls
      .filter((url) => url.includes('/search/tv'))
      .map((url) => new URL(url).searchParams.get('query'))
    expect(asked).toContain('Muderbot')
    expect(asked).toContain('Murderbot')
  })

  it('matches a show whose folder spells its accent as a combining mark', async () => {
    const anjin = await byFile('Sho\u0304gun - S01E01 - Anjin.mp4')
    expect(anjin).toMatchObject({
      match: 'matched',
      item: { type: 'episode', title: 'Anjin', show: { title: 'Shōgun' } },
    })
  })

  it('links each file to its episode, and a two-episode file to both', async () => {
    const halfLoop = await byFile('Severance - S01E02 - Half Loop.mp4')
    expect(halfLoop).toMatchObject({
      match: 'matched',
      item: {
        type: 'episode',
        title: 'Half Loop',
        show: { title: 'Severance' },
        season: 1,
        episode: 2,
      },
    })
    const fargo = await byFile('Fargo.S02E09E10.1080p.mp4')
    expect(fargo.item).toMatchObject({ type: 'episode', season: 2, episode: 9 })
    const fargoSeason = await item((await showNamed('Fargo')).show.id)
    const episodes = await item(fargoSeason.children[0]?.id)
    expect(episodes.children.map((episode) => episode.episode)).toEqual([9, 10])
    expect(episodes.children.map((episode) => episode.title)).toEqual(['The Castle', 'Palindrome'])
  })

  it('leaves an extra alone', async () => {
    expect(await byFile('Making Of.mp4')).toMatchObject({ match: 'off', item: null })
  })

  it('makes up an episode TMDB does not list, with the name the file gave', async () => {
    const frieren = await byFile('Frieren - (0012) S01E012 - A Real Hero.mp4')
    expect(frieren.item).toMatchObject({
      type: 'episode',
      title: 'A Real Hero',
      season: 1,
      episode: 12,
    })
    const show = await item((await showNamed('Frieren')).show.id)
    const season = await item(show.children[0]?.id)
    expect(season.children.map((episode) => episode.episode)).toEqual([12])
  })

  it("serves a show's page with its seasons on disk, creator, cast and crew", async () => {
    const details = await item((await showNamed('Severance')).show.id)
    expect(details).toMatchObject({
      type: 'show',
      tmdbId: '95396',
      contentRating: 'TV-MA',
      studio: 'Network One',
      released: '2022-02-18',
      ended: null,
      runtime: 45,
    })
    expect(details.children.map((season) => season.season)).toEqual([1, 2])
    expect(details.credits.map((credit) => `${credit.name}:${credit.job}`)).toEqual([
      'Adam Scott:cast',
      'Britt Lower:cast',
      'Dan Erickson:creator',
      'Ben Stiller:director',
      'Ben Stiller:producer',
    ])
  })

  it("serves a show's logo, offers it in Edit images, and learns an older show's in the sweep", async () => {
    const id = (await showNamed('Severance')).show.id
    const version = (await item(id)).logoVersion
    expect(version).toEqual(expect.any(String))
    const options = shape({
      response: await asAdmin({ method: 'GET', url: `/api/items/${id}/images` }),
      guard: isItemImageOptions,
    })
    expect(options.logo.find((option) => option.current)?.ref).toBe('/logo95396.png')

    const db = app().get(DatabaseService).db
    db.prepare("DELETE FROM item_images WHERE kind = 'logo' AND item_id = ?").run(id)
    db.prepare('UPDATE items SET logo_checked = 0 WHERE id = ?').run(id)
    expect((await item(id)).logoVersion).toBeNull()
    await app().get(ItemRefresher).sweep()
    expect((await item(id)).logoVersion).toBe(version)
  })

  it('marks a show and a season as favourites, but not an episode', async () => {
    const show = await item((await showNamed('Severance')).show.id)
    const season = show.children[0]
    expect(show.favourite).toBe(false)
    const mark = (target: number | undefined, favourite: unknown) =>
      app().inject({
        method: 'PUT',
        url: `/api/items/${target}/favourite`,
        payload: { favourite },
      })
    const marked = await mark(show.id, true)
    expect(shape({ response: marked, guard: isItemDetails }).favourite).toBe(true)
    expect((await mark(season?.id, true)).statusCode).toBe(200)
    const episode = (await item(season?.id)).children[0]
    expect((await mark(episode?.id, true)).statusCode).toBe(404)
    expect((await mark(show.id, 'yes')).statusCode).toBe(400)
    const titles = shape({
      response: await app().inject({ method: 'GET', url: '/api/favourites/titles' }),
      guard: isFavouriteTitles,
    })
    expect(titles.map((title) => title.id)).toEqual([season?.id, show.id])
    await mark(show.id, false)
    await mark(season?.id, false)
    expect((await item(show.id)).favourite).toBe(false)
  })

  it("gives a show's seasons their episode counts, and a season's episodes what their rows show", async () => {
    const show = await item((await showNamed('Severance')).show.id)
    const seasons = show.children.flatMap((child) =>
      child.type === ITEM_TYPES.season ? [child] : [],
    )
    expect(seasons.map((season) => [season.season, season.episodeCount])).toEqual([
      [1, 2],
      [2, 1],
    ])
    const season = await item(seasons[0]?.id)
    const episodes = season.children.flatMap((child) =>
      child.type === ITEM_TYPES.episode ? [child] : [],
    )
    const first = await byFile('Severance - S01E01 - Good News About Hell.mp4')
    const halfLoop = await byFile('Severance - S01E02 - Half Loop.mp4')
    expect(episodes.map((episode) => [episode.episode, episode.primary?.id ?? null])).toEqual([
      [1, first.id],
      [2, halfLoop.id],
    ])
    // The row says what the episode's own page would, without asking for it.
    const pages = await Promise.all(episodes.map((episode) => item(episode.id)))
    expect(
      episodes.map(({ summary, released, runtime, stillVersion }) => ({
        summary,
        released,
        runtime,
        stillVersion,
      })),
    ).toEqual(
      pages.map((page) => ({
        summary: page.summary,
        released: page.released,
        runtime: page.runtime,
        stillVersion: page.backdropVersion,
      })),
    )
    expect(episodes.every((episode) => episode.stillVersion != null)).toBe(true)
  })

  it("serves an episode's page with its guest stars and still", async () => {
    const halfLoop = await byFile('Severance - S01E02 - Half Loop.mp4')
    const details = await item(halfLoop.item?.id)
    expect(details).toMatchObject({
      type: 'episode',
      title: 'Half Loop',
      released: '2022-02-18',
      runtime: 50,
      show: { title: 'Severance' },
    })
    expect(details.credits.map((credit) => `${credit.name}:${credit.job}:${credit.role}`)).toEqual([
      'Tramell Tillman:guest:Mr. Milchick',
      'Ben Stiller:director:Director',
    ])
    expect(details.versions.map((version) => version.id)).toEqual([halfLoop.id])
    expect(details.backdropVersion).not.toBeNull()
    const still = await app().inject({
      method: 'GET',
      url: `/api/items/${details.id}/images/still`,
    })
    expect(still.statusCode).toBe(200)
    expect(still.rawPayload.equals(FAKE_JPEG)).toBe(true)
  })

  it('prefers the still and the show poster kept beside the files', async () => {
    const first = await byFile('Severance - S01E01 - Good News About Hell.mp4')
    const still = await app().inject({
      method: 'GET',
      url: `/api/items/${first.item?.id}/images/still`,
    })
    expect(still.statusCode).toBe(200)
    expect(still.rawPayload.equals(FAKE_JPEG)).toBe(false)
    const show = await showNamed('Severance')
    const poster = await app().inject({
      method: 'GET',
      url: `/api/items/${show.show.id}/images/poster`,
    })
    expect(poster.rawPayload.equals(FAKE_JPEG)).toBe(false)
  })

  it('points Play at the first episode not yet watched', async () => {
    const before = await showNamed('Severance')
    expect(before.next?.fileName).toBe('Severance - S01E01 - Good News About Hell.mp4')
    const first = await byFile('Severance - S01E01 - Good News About Hell.mp4')
    await app().inject({ method: 'POST', url: `/api/media/${first.id}/plays` })
    await app().inject({
      method: 'PUT',
      url: `/api/media/${first.id}/progress`,
      payload: { position: 1.95 },
    })
    const after = await showNamed('Severance')
    expect(after.next?.fileName).toBe('Severance - S01E02 - Half Loop.mp4')
    const next = await app().inject({ method: 'GET', url: `/api/items/${after.show.id}/next` })
    expect(next.statusCode).toBe(200)
    expect(next.json()).toMatchObject({ fileName: 'Severance - S01E02 - Half Loop.mp4' })
  })

  it('searches shows and sorts them by year', async () => {
    expect((await shows('?q=sev')).shows.map((entry) => entry.show.title)).toEqual(['Severance'])
    expect((await shows('?sort=year-new')).shows.map((entry) => entry.show.year)).toEqual([
      2025, 2024, 2023, 2022, 2014,
    ])
  })

  it('offers shows to Fix match, and points an unmatched folder at one', async () => {
    const results = await asAdmin({ method: 'GET', url: '/api/match/search?type=show&query=sever' })
    expect(results.statusCode).toBe(200)
    expect(results.json()).toMatchObject([{ tmdbId: '95396', title: 'Severance', year: 2022 }])

    const unknown = await byFile('Unknown Show - S01E01.mp4')
    const fixed = shape({
      response: await asAdmin({
        method: 'PUT',
        url: `/api/media/${unknown.id}/match`,
        payload: { tmdbId: '95396' },
      }),
      guard: isMediaItem,
    })
    expect(fixed).toMatchObject({
      match: 'manual',
      item: { type: 'episode', title: 'Good News About Hell', season: 1, episode: 1 },
    })
    expect((await shows()).unmatched).toEqual([])
    const episode = await item(fixed.item?.id)
    expect(episode.versions).toHaveLength(2)
  })

  it("re-points a whole show's files, keeping their numbers", async () => {
    const severance = await showNamed('Severance')
    const response = await asAdmin({
      method: 'PUT',
      url: `/api/items/${severance.show.id}/match`,
      payload: { tmdbId: '60622' },
    })
    expect(response.statusCode).toBe(200)
    const fargo = shape({ response, guard: isItemDetails })
    expect(fargo.title).toBe('Fargo')
    expect(fargo.children.map((season) => season.season)).toEqual([1, 2])
    const halfLoop = await byFile('Severance - S01E02 - Half Loop.mp4')
    expect(halfLoop.item).toMatchObject({ show: { title: 'Fargo' }, season: 1, episode: 2 })
    expect(halfLoop.match).toBe('manual')
    const gone = await app().inject({ method: 'GET', url: `/api/items/${severance.show.id}` })
    expect(gone.statusCode).toBe(404)
    expect((await shows()).shows.map((entry) => entry.show.title)).toEqual([
      'Fargo',
      'Frieren',
      'Murderbot',
      'Shōgun',
    ])
  })

  it('keeps the re-pointing through a rescan', async () => {
    await rescan()
    const halfLoop = await byFile('Severance - S01E02 - Half Loop.mp4')
    expect(halfLoop.item).toMatchObject({ show: { title: 'Fargo' } })
  })
  it('searches TMDB again for the files no show was found for, and only those', async () => {
    await encodeClip({
      path: join(state.media, 'Late Show', 'Season 1', 'Late Show - S01E01.mp4'),
      seconds: 1,
    })
    await rescan()
    expect((await byFile('Late Show - S01E01.mp4')).match).toBe('unmatched')
    const before = tmdb.state.calls.length

    const response = await asAdmin({ method: 'POST', url: `/api/libraries/${state.library}/match` })
    expect(response.statusCode).toBe(200)
    // The count is read after the retry, which sends the file back to pending.
    const library = shape({ response, guard: isLibrary })
    expect(library.unmatchedCount).toBe(0)
    await settle()
    const searched = tmdb.state.calls
      .slice(before)
      .filter((url) => url.includes('/search/tv'))
      .map((url) => new URL(url).searchParams.get('query'))
    expect(searched).toEqual(['Late Show'])
    expect((await byFile('Late Show - S01E01.mp4')).match).toBe('unmatched')
    expect((await byFile('Unknown Show - S01E01.mp4')).match).toBe('manual')

    tmdb.state.shows.push({ id: 4242, title: 'Late Show', first: '2024-03-01', seasons: { 1: [] } })
    await asAdmin({ method: 'POST', url: `/api/libraries/${state.library}/match` })
    await settle()
    expect((await byFile('Late Show - S01E01.mp4')).match).toBe('matched')
    expect((await shows()).shows.map((entry) => entry.show.title)).toContain('Late Show')
    const after = shape({
      response: await app().inject({ method: 'GET', url: `/api/libraries/${state.library}` }),
      guard: isLibrary,
    })
    expect(after.unmatchedCount).toBe(0)
  })

  it('tells two shows of one name apart by the country in the folder', async () => {
    tmdb.state.shows.push(
      {
        id: 2316,
        title: 'The Office',
        first: '2005-03-24',
        seasons: { 1: [{ number: 1, title: 'Pilot', aired: '2005-03-24' }] },
      },
      {
        id: 2996,
        title: 'The Office',
        first: '2001-07-09',
        countries: ['GB'],
        seasons: { 1: [{ number: 1, title: 'Downsize', aired: '2001-07-09' }] },
      },
    )
    await Promise.all(
      ['UK', 'US'].map((country) =>
        encodeClip({
          path: join(
            state.media,
            `The Office (${country})`,
            'Season 1',
            `The Office (${country}) - S01E01.mp4`,
          ),
          seconds: 1,
        }),
      ),
    )
    await rescan()
    expect(await byFile('The Office (UK) - S01E01.mp4')).toMatchObject({
      match: 'matched',
      item: { title: 'Downsize' },
    })
    expect(await byFile('The Office (US) - S01E01.mp4')).toMatchObject({
      match: 'matched',
      item: { title: 'Pilot' },
    })
  })
})

/** OMDb has no critics' scores for a show, so MDBList, when it has a key, is asked instead. */
describe('TV show scores from MDBList', () => {
  const tmdb = fakeTmdb({
    movies: [],
    shows: [
      {
        id: 95396,
        title: 'Severance',
        first: '2022-02-18',
        seasons: { 1: [{ number: 1, title: 'Good News About Hell', aired: '2022-02-18' }] },
      },
    ],
    mdblist: { 'show:95396': { imdb: 87, rottenTomatoes: 96, metacritic: 84, imdbVotes: 300_000 } },
    omdb: { tt95396: { imdb: '8.7/10' } },
  })
  const state: { root: string; app: NestFastifyApplication | null; library: number } = {
    root: '',
    app: null,
    library: 0,
  }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-show-scores-'))
    const media = join(state.root, 'TV')
    await encodeClip({
      path: join(media, 'Severance (2022)', 'Season 01', 'Severance - S01E01.mp4'),
      seconds: 1,
    })
    state.app = await createApp({
      config: {
        ...testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
        tmdbApiToken: 'test-token',
        omdbApiKey: 'omdb-key',
        mdblistApiKey: 'mdblist-key',
      },
      quiet: true,
      metadataFetch: tmdb.fetch,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    const admin = await adminCookie(state.app)
    state.library = shape({
      response: await injectAs({ app: state.app, cookie: admin })({
        method: 'POST',
        url: '/api/libraries',
        payload: { name: 'TV', paths: [media], settings: { kind: 'shows' } },
      }),
      guard: isLibrary,
    }).id
    await app().get(ScannerService).whenIdle(state.library)
    await app().get(MetadataService).whenIdle()
    await app().get(ScoreSweep).whenIdle()
    await app().get(ThumbnailService).whenIdle()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('gives a show Rotten Tomatoes and Metacritic scores, and asks OMDb nothing', async () => {
    const listing = shape({
      response: await app().inject({
        method: 'GET',
        url: `/api/libraries/${state.library}/shows`,
      }),
      guard: isShowListing,
    })
    expect(
      listing.shows[0]?.show.ratings.map((rating) => [rating.source, rating.value, rating.votes]),
    ).toEqual([
      ['rottenTomatoes', 9.6, null],
      ['imdb', 8.7, 300_000],
      ['metacritic', 8.4, null],
      ['tmdb', 8.5, 500],
    ])
    expect(tmdb.state.mdblistCalls).toBe(1)
    expect(tmdb.state.omdbCalls).toBe(0)
  })
})
