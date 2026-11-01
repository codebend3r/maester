import { describe, expect, it } from 'bun:test'
import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  AUDIO_BITRATES,
  AUDIO_BITRATE_PARAM,
  AUDIO_CODECS,
  AUDIO_PLATFORMS,
  MAX_HEIGHTS,
  MEDIA_TICKET_PARAM,
  type Track,
  appClientCallOf,
  createApiClient,
  toQueryString,
} from '@raven/core'

import { type TrackPlan, audioItemOf } from '@/music/audioItem'
import { mediaAccessFor } from '@/servers/mediaAccess'

const ORIGIN = 'https://raven.example'
const TICKET = 'tkt.wren'

const RAVEN = { id: 'raven', name: 'raven', origin: ORIGIN, addedAt: 1 }

const AIRBAG: Track = {
  id: 101,
  libraryId: 5,
  albumId: 7,
  title: 'Airbag',
  disc: 1,
  number: 1,
  duration: 284,
  artists: [{ id: 1, name: 'Radiohead' }],
  container: 'flac',
  codec: AUDIO_CODECS.flac,
  bitrate: 900000,
  sampleRate: 44100,
  bitDepth: 16,
  isLossless: true,
  mbid: null,
  addedAt: '2026-01-01T00:00:00Z',
  album: { title: 'OK Computer', coverVersion: 'v1' },
}

const ALAC_AIRBAG: Track = { ...AIRBAG, container: 'm4a', codec: AUDIO_CODECS.alac }

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

/**
 * raven as Wren's player reaches it, with no other origin to play from and a signed-in
 * account, so a track plays from raven's own address by its ticket. `heard` is every call.
 */
const ravenServer = () => {
  const heard: string[] = []
  const api = createApiClient({
    baseUrl: ORIGIN,
    fetch: async (input) => {
      const url = String(input)
      const call = appClientCallOf({ method: APP_CALL_METHODS.get, url })
      heard.push(call ?? url)
      if (call === null) return new Response(null, { status: 404 })
      if (APP_CLIENT_CALLS[call] === APP_CLIENT_CALLS.getMediaTicket) {
        return json({ ticket: TICKET, expiresAt: 0 })
      }
      return json({ origins: [] })
    },
  })
  const sources = mediaAccessFor({
    api,
    server: RAVEN,
    now: () => 1_000,
    probe: async () => ({ ok: false, bytes: 0, elapsedMs: 1 }),
    readCookies: async () => ({}),
    readAccessToken: () => 'token.signed-in',
    watchNetwork: () => () => undefined,
    awayMaxHeight: () => MAX_HEIGHTS.fullHd,
  })
  return { server: { api, sources }, heard }
}

/** Wren's plan with nothing downloaded and the device on Wi-Fi: the file itself plays. */
const ON_WIFI: TrackPlan = { downloadedOf: () => null, streamKbps: async () => null }

const ON_CELLULAR: TrackPlan = { ...ON_WIFI, streamKbps: async () => AUDIO_BITRATES.standard }

const DOWNLOADED_URI = 'file:///data/Documents/downloads/raven/101/media.m4a'
const SAVED_COVER = 'file:///data/Documents/downloads/raven/101/cover.jpg'

const transcodeUri = (kbps: number) =>
  `${ORIGIN}/api/media/${AIRBAG.id}/transcode?${toQueryString({
    [AUDIO_BITRATE_PARAM]: String(kbps),
    [MEDIA_TICKET_PARAM]: TICKET,
  })}`

describe('audioItemOf', () => {
  it("plays a FLAC track on an iPhone from the file itself, by its ticket, with the lock screen's details", async () => {
    const { server } = ravenServer()
    const item = await audioItemOf({
      server,
      track: AIRBAG,
      platform: AUDIO_PLATFORMS.apple,
      plan: ON_WIFI,
    })
    expect(item).toEqual({
      id: AIRBAG.id,
      uri: `${ORIGIN}/api/media/${AIRBAG.id}/file?${MEDIA_TICKET_PARAM}=${TICKET}`,
      headers: {},
      title: 'Airbag',
      artist: 'Radiohead',
      album: 'OK Computer',
      artworkUri: server.api.albumCoverUrl({ albumId: AIRBAG.albumId, coverVersion: 'v1' }),
      duration: 284,
    })
  })

  it('plays a downloaded track from its file with no headers and its saved cover, asking the server nothing', async () => {
    const { server, heard } = ravenServer()
    const item = await audioItemOf({
      server,
      track: AIRBAG,
      platform: AUDIO_PLATFORMS.android,
      plan: {
        ...ON_CELLULAR,
        downloadedOf: () => ({ uri: DOWNLOADED_URI, artworkUri: SAVED_COVER }),
      },
    })
    expect(item.uri).toBe(DOWNLOADED_URI)
    expect(item.headers).toEqual({})
    expect(item.artworkUri).toBe(SAVED_COVER)
    expect(heard).toEqual([])
  })

  it('streams the transcode at the cellular bitrate on a mobile network', async () => {
    const { server } = ravenServer()
    const item = await audioItemOf({
      server,
      track: AIRBAG,
      platform: AUDIO_PLATFORMS.apple,
      plan: ON_CELLULAR,
    })
    expect(item.uri).toBe(transcodeUri(AUDIO_BITRATES.standard))
  })

  it('plays ALAC on Android from the transcode, since its player plays the file silent', async () => {
    const { server } = ravenServer()
    const item = await audioItemOf({
      server,
      track: ALAC_AIRBAG,
      platform: AUDIO_PLATFORMS.android,
      plan: ON_WIFI,
    })
    expect(item.uri).toBe(transcodeUri(AUDIO_BITRATES.standard))
  })

  it('plays ALAC on an iPhone from the file, which it decodes', async () => {
    const { server } = ravenServer()
    const item = await audioItemOf({
      server,
      track: ALAC_AIRBAG,
      platform: AUDIO_PLATFORMS.apple,
      plan: ON_WIFI,
    })
    expect(item.uri).toBe(`${ORIGIN}/api/media/${AIRBAG.id}/file?${MEDIA_TICKET_PARAM}=${TICKET}`)
  })
})
