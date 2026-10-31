import { describe, expect, it } from 'bun:test'
import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  AUDIO_CODECS,
  AUDIO_PLATFORMS,
  MAX_HEIGHTS,
  MEDIA_TICKET_PARAM,
  type Track,
  appClientCallOf,
  createApiClient,
} from '@raven/core'

import { audioItemOf } from '@/music/audioItem'
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

describe('audioItemOf', () => {
  it('gives no item for an ALAC track on Android, whose player plays it silent', async () => {
    const { server, heard } = ravenServer()
    expect(
      await audioItemOf({ server, track: ALAC_AIRBAG, platform: AUDIO_PLATFORMS.android }),
    ).toBeNull()
    expect(heard).toEqual([])
  })

  it("plays a FLAC track on an iPhone from the file itself, by its ticket, with the lock screen's details", async () => {
    const { server } = ravenServer()
    const item = await audioItemOf({ server, track: AIRBAG, platform: AUDIO_PLATFORMS.apple })
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

  it('plays ALAC on an iPhone, which decodes it', async () => {
    const { server } = ravenServer()
    const item = await audioItemOf({ server, track: ALAC_AIRBAG, platform: AUDIO_PLATFORMS.apple })
    expect(item?.id ?? null).toBe(AIRBAG.id)
  })
})
