import { describe, expect, it } from 'vitest'
import { ApiError, type FetchInit, type FetchResponse, createApiClient } from '@/apiClient'
import { mediaItem } from '@/test/fixtures'

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
