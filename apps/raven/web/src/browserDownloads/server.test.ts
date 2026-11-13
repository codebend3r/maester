import {
  createApiClient,
  MEDIA_ORIGIN_KINDS,
  type MediaOrigin,
  ITEM_IMAGE_KINDS,
} from '@raven/core'
import { describe, expect, it } from 'bun:test'
import {
  mediaServerFor,
  MINT_WINDOW_MS,
  MINTS_PER_WINDOW,
  TICKET_REUSE_MS,
} from '@/browserDownloads/server'
import { DOWNLOAD_WAYS } from '@/browserDownloads/ways'
import { fakeClock } from '@/test/browserDownloads'
import { HEADERS } from '@shared/http'

const ORIGIN: MediaOrigin = { kind: MEDIA_ORIGIN_KINDS.public, url: 'https://media.example' }

type Sent = { url: string; headers: Record<string, string> }

type ServedProps = { origin?: MediaOrigin | null }

/** A media server over an API client whose every request is recorded and answered from a table. */
const served = ({ origin = null }: ServedProps = {}) => {
  const sent: Sent[] = []
  const minted = { count: 0 }
  const answer = (url: string): Response => {
    if (url.includes('/ticket')) {
      minted.count += 1
      return Response.json({ ticket: `ticket-${minted.count}`, expiresAt: 0 })
    }
    if (url.includes('/subtitles/')) return new Response('WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n')
    if (url.includes('/pictures/') && url.includes('missing')) {
      return new Response('', { status: 404 })
    }
    return new Response('bytes', { headers: { 'content-type': 'image/jpeg' } })
  }
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    sent.push({ url, headers: { ...Object(init?.headers ?? {}) } })
    return answer(url)
  }
  const clock = fakeClock()
  const server = mediaServerFor({
    api: createApiClient({ fetch }),
    fetch,
    origin: () => origin,
    clock: clock.clock,
  })
  const signal = new AbortController().signal
  const fetched = () => sent.filter(({ url }) => !url.includes('/ticket'))
  return { server, sent, fetched, minted, clock, signal }
}

describe('mediaServerFor', () => {
  it("fetches the original from the page's own origin by its cookie, named a download", async () => {
    const { server, fetched, minted, signal } = served()
    await server.bytes({ mediaId: 7, way: DOWNLOAD_WAYS.file, from: 0, signal, isFresh: false })
    expect(fetched()).toEqual([{ url: '/api/media/7/file?purpose=download', headers: {} }])
    expect(minted.count).toBe(0)
  })

  it('asks for the rest of a file with a range', async () => {
    const { server, fetched, signal } = served()
    await server.bytes({ mediaId: 7, way: DOWNLOAD_WAYS.file, from: 512, signal, isFresh: false })
    expect(fetched()[0]?.headers ?? null).toEqual({ [HEADERS.range]: 'bytes=512-' })
  })

  it("fetches a copy from the server's copy route, naming the SDR one", async () => {
    const { server, fetched, signal } = served()
    await server.bytes({ mediaId: 7, way: DOWNLOAD_WAYS.copy, from: 0, signal, isFresh: false })
    await server.bytes({ mediaId: 7, way: DOWNLOAD_WAYS.sdr, from: 0, signal, isFresh: false })
    expect(fetched().map(({ url }) => url)).toEqual([
      '/api/media/7/device-download/file?purpose=download',
      '/api/media/7/device-download/file?variant=sdr&purpose=download',
    ])
  })

  it('fetches through a media origin with a ticket, used again while it is fresh', async () => {
    const { server, fetched, minted, clock, signal } = served({ origin: ORIGIN })
    const ask = { mediaId: 7, way: DOWNLOAD_WAYS.file, from: 0, signal, isFresh: false }
    await server.bytes(ask)
    await server.bytes(ask)
    expect(fetched().map(({ url }) => url)).toEqual([
      'https://media.example/api/media/7/file?t=ticket-1&purpose=download',
      'https://media.example/api/media/7/file?t=ticket-1&purpose=download',
    ])
    clock.state.now += TICKET_REUSE_MS
    await server.bytes(ask)
    expect(minted.count).toBe(2)
  })

  it('mints a new ticket when the last one was refused', async () => {
    const { server, fetched, signal } = served({ origin: ORIGIN })
    await server.bytes({ mediaId: 7, way: DOWNLOAD_WAYS.file, from: 0, signal, isFresh: false })
    await server.bytes({ mediaId: 7, way: DOWNLOAD_WAYS.file, from: 0, signal, isFresh: true })
    expect(fetched()[1]?.url ?? null).toContain('t=ticket-2')
  })

  it("waits, rather than mint past the queue's share of the account's tickets", async () => {
    const { server, minted, clock, signal } = served({ origin: ORIGIN })
    const asks = Array.from({ length: MINTS_PER_WINDOW + 1 }, (_, index) => index + 1)
    await asks.reduce<Promise<unknown>>(async (previous, mediaId) => {
      await previous
      return server.bytes({ mediaId, way: DOWNLOAD_WAYS.file, from: 0, signal, isFresh: false })
    }, Promise.resolve())
    expect(minted.count).toBe(MINTS_PER_WINDOW + 1)
    expect(clock.slept).toEqual([MINT_WINDOW_MS])
  })

  it('mints nothing for a run stopped while it waits its turn', async () => {
    const { server, minted, signal: live } = served({ origin: ORIGIN })
    const asks = Array.from({ length: MINTS_PER_WINDOW }, (_, index) => index + 1)
    await asks.reduce<Promise<unknown>>(async (previous, mediaId) => {
      await previous
      return server.bytes({
        mediaId,
        way: DOWNLOAD_WAYS.file,
        from: 0,
        signal: live,
        isFresh: false,
      })
    }, Promise.resolve())
    const stopped = new AbortController()
    stopped.abort()
    const waiting = server.bytes({
      mediaId: 99,
      way: DOWNLOAD_WAYS.file,
      from: 0,
      signal: stopped.signal,
      isFresh: false,
    })
    await expect(waiting).rejects.toBeDefined()
    expect(minted.count).toBe(MINTS_PER_WINDOW)
  })

  it('reads a picture at its capability address, and has none where the server has none', async () => {
    const { server, fetched } = served()
    const poster = await server.picture({ itemId: 4, kind: ITEM_IMAGE_KINDS.poster, version: 'v1' })
    expect(poster?.type ?? null).toBe('image/jpeg')
    expect(fetched()[0]?.url ?? null).toBe('/api/pictures/items/4/poster/v1')
    expect(
      await server.picture({ itemId: 4, kind: ITEM_IMAGE_KINDS.logo, version: 'missing' }),
    ).toBeNull()
  })

  it("reads a subtitle window's cues, with the media origin's ticket when there is one", async () => {
    const { server, fetched, signal } = served({ origin: ORIGIN })
    const cues = await server.cues({ mediaId: 7, trackId: 'embedded-0', window: 2, signal })
    expect(cues).toEqual([{ start: 1, end: 2, text: 'Hi' }])
    expect(fetched()[0]?.url ?? null).toBe(
      'https://media.example/api/media/7/subtitles/embedded-0?window=2&t=ticket-1',
    )
  })
})
