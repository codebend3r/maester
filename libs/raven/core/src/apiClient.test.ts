import { describe, expect, it } from 'vitest'
import {
  type ApiClient,
  ApiError,
  type FetchInit,
  type FetchResponse,
  createApiClient,
  isLockedError,
  parseServerEvent,
} from '@/apiClient'
import { itemDetails, library, mediaItem, showEntry } from '@/test/fixtures'

type Call = { url: string; init?: FetchInit }

const respond = ({ status = 200, body }: { status?: number; body?: unknown }): FetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : 'Error',
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
})

const clientReturning = (response: FetchResponse) => {
  const calls: Call[] = []
  const client = createApiClient({
    baseUrl: 'http://nas:8484/',
    fetch: async (url, init) => {
      calls.push({ url, init })
      return response
    },
  })
  return { client, calls }
}

describe('createApiClient', () => {
  it('returns media that passes the guard', async () => {
    const item = mediaItem()
    const { client, calls } = clientReturning(respond({ body: [item] }))
    await expect(client.listMedia({ libraryId: 3, search: ' matrix ' })).resolves.toEqual([item])
    expect(calls[0]?.url).toBe('http://nas:8484/api/libraries/3/media?sort=title&q=matrix')
  })

  it('sends the shuffle seed with a random sort', async () => {
    const { client, calls } = clientReturning(respond({ body: [] }))
    await client.listMedia({ libraryId: 3, sort: 'random', seed: 42 })
    expect(calls[0]?.url).toBe('http://nas:8484/api/libraries/3/media?sort=random&seed=42')
  })

  it('asks the server to match a library again', async () => {
    const { client, calls } = clientReturning(respond({ body: library() }))
    await expect(client.matchLibrary(3)).resolves.toEqual(library())
    expect(calls[0]).toMatchObject({
      url: 'http://nas:8484/api/libraries/3/match',
      init: { method: 'POST' },
    })
  })

  it('reads and writes an item’s metadata over TMDB’s', async () => {
    const state = {
      shown: {
        title: 'Heat (Director’s Cut)',
        year: 1995,
        tagline: null,
        summary: null,
        contentRating: 'R',
      },
      original: { title: 'Heat', year: 1995, tagline: null, summary: null, contentRating: 'R' },
      overridden: ['title'],
    }
    const { client, calls } = clientReturning(respond({ body: state }))
    await expect(client.getItemMetadata(9)).resolves.toEqual(state)
    expect(calls[0]?.url).toBe('http://nas:8484/api/items/9/metadata')
    const edited = clientReturning(respond({ body: itemDetails() }))
    await edited.client.setItemMetadata({ id: 9, change: { title: null, tagline: 'Hot.' } })
    expect(edited.calls[0]).toMatchObject({
      url: 'http://nas:8484/api/items/9/metadata',
      init: { method: 'PUT', body: '{"title":null,"tagline":"Hot."}' },
    })
  })

  it('lists the pictures an item could show, and chooses one', async () => {
    const options = {
      poster: [
        {
          source: 'tmdb',
          ref: '/p1.jpg',
          width: 2000,
          height: 3000,
          language: 'en',
          current: true,
        },
      ],
      backdrop: [],
      logo: [],
    }
    const { client, calls } = clientReturning(respond({ body: options }))
    await expect(client.getItemImages(9)).resolves.toEqual(options)
    expect(calls[0]?.url).toBe('http://nas:8484/api/items/9/images')

    const chosen = clientReturning(respond({ body: itemDetails() }))
    await chosen.client.chooseItemImage({ id: 9, kind: 'backdrop', choice: { source: 'local' } })
    expect(chosen.calls[0]).toMatchObject({
      url: 'http://nas:8484/api/items/9/images/backdrop',
      init: { method: 'PUT', body: '{"source":"local"}' },
    })

    const option = options.poster[0]
    if (!option) throw new Error('no option')
    expect(
      client.imageOptionUrl({ id: 9, kind: 'poster', option: { ...option, source: 'tmdb' } }),
    ).toBe('http://nas:8484/api/images/poster/p1.jpg')
    expect(
      client.imageOptionUrl({ id: 9, kind: 'poster', option: { ...option, source: 'local' } }),
    ).toBe('http://nas:8484/api/items/9/images/poster/local')
  })

  it('sends JSON bodies', async () => {
    const { client, calls } = clientReturning(respond({ status: 204 }))
    await client.saveProgress({ id: 7, position: 93.5 })
    expect(calls[0]?.init).toMatchObject({
      method: 'PUT',
      body: '{"position":93.5}',
      headers: { 'content-type': 'application/json' },
    })
  })

  it('surfaces the server error message', async () => {
    const { client } = clientReturning(
      respond({ status: 400, body: { statusCode: 400, message: ['Add at least one folder.'] } }),
    )
    await expect(client.createLibrary({ name: 'x', paths: [] })).rejects.toThrow(
      new ApiError({ status: 400, message: 'Add at least one folder.' }),
    )
  })

  it('rejects a response that does not match the contract', async () => {
    const { client } = clientReturning(respond({ body: [{ id: 'nope' }] }))
    await expect(client.listLibraries()).rejects.toBeInstanceOf(ApiError)
  })

  it('only hands out a thumbnail URL once one exists', () => {
    const { client } = clientReturning(respond({}))
    expect(client.thumbnailUrl(mediaItem({ id: 4, thumbnailVersion: 99 }))).toBe(
      'http://nas:8484/api/media/4/thumbnail?v=99',
    )
    expect(client.thumbnailUrl(mediaItem({ thumbnail: 'pending' }))).toBeNull()
  })

  it('points a player at the original file', () => {
    const { client } = clientReturning(respond({}))
    expect(client.fileUrl(5)).toBe('http://nas:8484/api/media/5/file')
  })

  it('marks a favourite and returns the updated item', async () => {
    const item = mediaItem({ id: 4, favourite: true })
    const { client, calls } = clientReturning(respond({ body: item }))
    await expect(client.setFavourite({ id: 4, favourite: true })).resolves.toEqual(item)
    expect(calls[0]?.url).toBe('http://nas:8484/api/media/4/favourite')
    expect(calls[0]?.init).toMatchObject({ method: 'PUT', body: '{"favourite":true}' })
  })

  it('lists favourites across every library, each with the poster its card shows', async () => {
    const entry = { media: mediaItem({ favourite: true }), poster: null }
    const { client, calls } = clientReturning(respond({ body: [entry] }))
    await expect(client.listFavourites()).resolves.toEqual([entry])
    expect(calls[0]?.url).toBe('http://nas:8484/api/favourites')
  })

  it("asks for a library's videos in progress, favourites, sagas and files not matched", async () => {
    const entry = { media: mediaItem({ favourite: true }), poster: null }
    const asked = async <T>({
      body,
      call,
    }: {
      body: T
      call: (client: ApiClient) => Promise<T>
    }) => {
      const { client, calls } = clientReturning(respond({ body }))
      await expect(call(client)).resolves.toEqual(body)
      return calls[0]?.url
    }
    expect([
      await asked({ body: [entry], call: (client) => client.listInProgress(3) }),
      await asked({ body: [entry], call: (client) => client.listLibraryFavourites(3) }),
      await asked({ body: [mediaItem()], call: (client) => client.listUnmatched(3) }),
    ]).toEqual([
      'http://nas:8484/api/libraries/3/in-progress',
      'http://nas:8484/api/libraries/3/favourites',
      'http://nas:8484/api/libraries/3/unmatched',
    ])
  })

  it('reads and changes the display settings', async () => {
    const { client, calls } = clientReturning(respond({ body: { titles: 'text' } }))
    await expect(client.getDisplaySettings()).resolves.toEqual({ titles: 'text' })
    await expect(client.setDisplaySettings({ titles: 'text' })).resolves.toEqual({ titles: 'text' })
    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ['http://nas:8484/api/settings/display', 'GET'],
      ['http://nas:8484/api/settings/display', 'PUT'],
    ])
  })

  it('records that a video started playing', async () => {
    const { client, calls } = clientReturning(respond({ status: 204 }))
    await client.recordPlay(6)
    expect(calls[0]).toMatchObject({
      url: 'http://nas:8484/api/media/6/plays',
      init: { method: 'POST' },
    })
  })

  it("lists a library's history, asking for as many as it wants", async () => {
    const entry = {
      media: mediaItem(),
      lastPlayedAt: '2026-10-10T19:00:00.000Z',
      plays: 1,
      furthest: 30,
      watched: false,
    }
    const { client, calls } = clientReturning(respond({ body: [entry] }))
    await expect(client.listHistory({ libraryId: 3, limit: 50 })).resolves.toEqual([entry])
    expect(calls[0]?.url).toBe('http://nas:8484/api/libraries/3/history?limit=50')
    await client.listHistory({ libraryId: 3, limit: 50, watchedOnly: true })
    expect(calls[1]?.url).toBe('http://nas:8484/api/libraries/3/history?limit=50&watched=true')
  })

  it("asks where a video's file lives", async () => {
    const { client, calls } = clientReturning(respond({ body: { path: '/media/Movies/a.mkv' } }))
    await expect(client.getMediaLocation(7)).resolves.toEqual({ path: '/media/Movies/a.mkv' })
    expect(calls[0]?.url).toBe('http://nas:8484/api/media/7/location')
  })

  it('points an event source at the server', () => {
    const { client } = clientReturning(respond({}))
    expect(client.eventsUrl()).toBe('http://nas:8484/api/events')
  })

  it('reads the events it knows and drops the rest', () => {
    expect(parseServerEvent('{"type":"library","libraryId":2}')).toEqual({
      type: 'library',
      libraryId: 2,
    })
    expect(parseServerEvent('{"type":"party"}')).toBeNull()
    expect(parseServerEvent('not json')).toBeNull()
  })

  it('unlocks with a PIN, and locks again', async () => {
    const { client, calls } = clientReturning(
      respond({ body: { available: true, unlocked: true } }),
    )
    await expect(client.unlock('3001')).resolves.toEqual({ available: true, unlocked: true })
    expect(calls[0]?.url).toBe('http://nas:8484/api/lock/unlock')
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ pin: '3001' }))
    await client.lock()
    expect(calls[1]?.url).toBe('http://nas:8484/api/lock/lock')
  })

  it('tells a locked library apart from other failures', async () => {
    const { client } = clientReturning(
      respond({ status: 423, body: { statusCode: 423, message: 'This library is locked.' } }),
    )
    const failure = await client.getMedia(7).catch((error: unknown) => error)
    expect(isLockedError(failure)).toBe(true)
    expect(isLockedError(new ApiError({ status: 403, message: 'No' }))).toBe(false)
  })

  it('deletes a video', async () => {
    const { client, calls } = clientReturning(respond({ status: 204 }))
    await client.deleteMedia(9)
    expect(calls[0]).toMatchObject({
      url: 'http://nas:8484/api/media/9',
      init: { method: 'DELETE' },
    })
  })
})

describe('playback calls', () => {
  it('checks the track list against the contract', async () => {
    const tracks = {
      audio: [
        { index: 0, codec: 'truehd', channels: 8, language: 'eng', title: null, default: true },
      ],
      subtitles: [
        {
          id: 'external-0',
          source: 'external',
          codec: 'srt',
          language: 'en',
          title: null,
          default: false,
          forced: true,
          hearingImpaired: false,
          supported: true,
        },
      ],
      defaultAudio: 0,
      frameRate: 23.976,
    }
    const { client, calls } = clientReturning(respond({ body: tracks }))
    await expect(client.getTracks(7)).resolves.toEqual(tracks)
    expect(calls[0]?.url).toBe('http://nas:8484/api/media/7/tracks')
    const { client: broken } = clientReturning(respond({ body: { audio: 'eng' } }))
    await expect(broken.getTracks(7)).rejects.toBeInstanceOf(ApiError)
  })

  it('fetches a subtitle window and parses it', async () => {
    const vtt = 'WEBVTT\n\n05:01.000 --> 05:02.000\nHello'
    const { client, calls } = clientReturning(respond({ body: vtt }))
    await expect(client.getSubtitles({ id: 7, trackId: 'embedded-2', window: 1 })).resolves.toEqual(
      [{ start: 301, end: 302, text: 'Hello' }],
    )
    expect(calls[0]?.url).toBe('http://nas:8484/api/media/7/subtitles/embedded-2?window=1')
  })

  it('fails a subtitle request with the server message', async () => {
    const { client } = clientReturning(
      respond({ status: 404, body: { statusCode: 404, message: 'No subtitle track x' } }),
    )
    await expect(client.getSubtitles({ id: 7, trackId: 'x' })).rejects.toThrow(
      'No subtitle track x',
    )
  })

  it('builds stream URLs', () => {
    const { client } = clientReturning(respond({}))
    expect(client.streamUrl({ id: 7, mode: 'remux', start: 61.23456, audio: 2 })).toBe(
      'http://nas:8484/api/media/7/stream?mode=remux&start=61.235&audio=2',
    )
    expect(client.streamUrl({ id: 7, mode: 'transcode', start: -3, audio: null })).toBe(
      'http://nas:8484/api/media/7/stream?mode=transcode&start=0',
    )
  })
})

describe('the metadata calls', () => {
  it('fetches an item and checks it against the contract', async () => {
    const details = itemDetails()
    const { client, calls } = clientReturning(respond({ body: details }))
    await expect(client.getItem(1)).resolves.toEqual(details)
    expect(calls[0]?.url).toBe('http://nas:8484/api/items/1')
  })

  it('searches TMDB through the server with the year when there is one', async () => {
    const { client, calls } = clientReturning(respond({ body: [] }))
    await client.searchMatches({ type: 'movie', query: ' The Matrix ', year: 1999 })
    expect(calls[0]?.url).toBe(
      'http://nas:8484/api/match/search?type=movie&query=The%20Matrix&year=1999',
    )
  })

  it('saves a match, or the lack of one', async () => {
    const { client, calls } = clientReturning(respond({ body: mediaItem() }))
    await client.setMatch({ mediaId: 7, tmdbId: null })
    expect(calls[0]).toMatchObject({
      url: 'http://nas:8484/api/media/7/match',
      init: { method: 'PUT', body: '{"tmdbId":null}' },
    })
  })

  it('lists a TV library as shows, with the search and sort', async () => {
    const listing = { shows: [showEntry()], unmatched: [] }
    const { client, calls } = clientReturning(respond({ body: listing }))
    await expect(client.listShows({ libraryId: 3, search: 'sev', sort: 'added' })).resolves.toEqual(
      listing,
    )
    expect(calls[0]?.url).toBe('http://nas:8484/api/libraries/3/shows?sort=added&q=sev')
  })

  it('fetches a person and builds avatar URLs', async () => {
    const person = {
      id: 5,
      name: 'Keanu Reeves',
      photoVersion: 'k',
      credits: [{ item: itemDetails().versions[0]?.item, job: 'cast', role: 'Neo' }],
    }
    const { client, calls } = clientReturning(respond({ body: person }))
    await expect(client.getPerson(5)).resolves.toEqual(person)
    expect(calls[0]?.url).toBe('http://nas:8484/api/people/5')
    expect(client.reviewAvatarUrl({ reviewId: 3, avatarVersion: 'a1' })).toBe(
      'http://nas:8484/api/reviews/3/avatar?v=a1',
    )
    expect(client.reviewAvatarUrl({ reviewId: 3, avatarVersion: null })).toBeNull()
  })

  it('asks for the next episode of a show, which may be none', async () => {
    const { client, calls } = clientReturning(respond({ body: null }))
    await expect(client.nextEpisode(4)).resolves.toBeNull()
    expect(calls[0]?.url).toBe('http://nas:8484/api/items/4/next')
  })

  it("re-points a show's files", async () => {
    const { client, calls } = clientReturning(respond({ body: itemDetails() }))
    await client.setItemMatch({ itemId: 4, tmdbId: '95396' })
    expect(calls[0]).toMatchObject({
      url: 'http://nas:8484/api/items/4/match',
      init: { method: 'PUT', body: '{"tmdbId":"95396"}' },
    })
  })

  it('posts a refresh', async () => {
    const { client, calls } = clientReturning(respond({ body: itemDetails() }))
    await client.refreshItem(4)
    expect(calls[0]).toMatchObject({
      url: 'http://nas:8484/api/items/4/refresh',
      init: { method: 'POST' },
    })
  })

  it('reads the metadata part of the health check', async () => {
    const metadata = { tmdb: 'ok', omdb: 'off', pending: 3, error: null, lastOk: null }
    const health = {
      status: 'ok',
      ffmpeg: '7.1',
      tonemap: true,
      encoder: 'software',
      thumbnailsPending: 0,
      metadata,
    }
    const { client } = clientReturning(respond({ body: health }))
    await expect(client.getMetadataHealth()).resolves.toEqual(metadata)
  })

  it('refuses a health check it does not understand', async () => {
    const metadata = { tmdb: 'ok', omdb: 'off', pending: 3, error: null, lastOk: null }
    const { client } = clientReturning(respond({ body: { status: 'ok', metadata } }))
    await expect(client.getMetadataHealth()).rejects.toMatchObject({ status: 502 })
  })

  it('builds versioned image URLs, and none without a version', () => {
    const { client } = clientReturning(respond({}))
    expect(client.itemImageUrl({ id: 2, kind: 'poster', version: 'abc' })).toBe(
      'http://nas:8484/api/items/2/images/poster?v=abc',
    )
    expect(client.itemImageUrl({ id: 2, kind: 'backdrop', version: null })).toBeNull()
    expect(client.libraryBackdropUrl({ type: 'item', id: 3, version: 'def' })).toBe(
      'http://nas:8484/api/items/3/images/backdrop?v=def',
    )
    expect(client.libraryBackdropUrl({ type: 'thumbnail', id: 8, version: 41 })).toBe(
      'http://nas:8484/api/media/8/thumbnail?v=41',
    )
    expect(client.photoUrl({ personId: 5, photoVersion: 'x' })).toBe(
      'http://nas:8484/api/people/5/photo?v=x',
    )
    expect(client.candidatePosterUrl('/abc.jpg')).toBe('http://nas:8484/api/images/poster/abc.jpg')
  })
})
