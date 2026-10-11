import { describe, expect, it } from 'vitest'
import { ApiError, type FetchInit, type FetchResponse, createApiClient } from '@/apiClient'
import { itemDetails, mediaItem, showEntry } from '@/test/fixtures'

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

  it('lists favourites across every library', async () => {
    const item = mediaItem({ favourite: true })
    const { client, calls } = clientReturning(respond({ body: [item] }))
    await expect(client.listFavourites()).resolves.toEqual([item])
    expect(calls[0]?.url).toBe('http://nas:8484/api/favourites')
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
    const { client } = clientReturning(respond({ body: { status: 'ok', metadata } }))
    await expect(client.getMetadataHealth()).resolves.toEqual(metadata)
  })

  it('builds versioned image URLs, and none without a version', () => {
    const { client } = clientReturning(respond({}))
    expect(client.itemImageUrl({ id: 2, kind: 'poster', version: 'abc' })).toBe(
      'http://nas:8484/api/items/2/images/poster?v=abc',
    )
    expect(client.itemImageUrl({ id: 2, kind: 'backdrop', version: null })).toBeNull()
    expect(client.photoUrl({ personId: 5, photoVersion: 'x' })).toBe(
      'http://nas:8484/api/people/5/photo?v=x',
    )
    expect(client.candidatePosterUrl('/abc.jpg')).toBe('http://nas:8484/api/images/poster/abc.jpg')
  })
})
