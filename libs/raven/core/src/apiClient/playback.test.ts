import { describe, expect, it } from 'bun:test'
import { ApiError, type MediaAccess } from '@/apiClient'
import {
  DEVICE_DOWNLOAD_STATES,
  MEDIA_ORIGIN_KINDS,
  MEDIA_PROBE_BYTES,
  type MediaOrigin,
  type MediaStreams,
  type MediaTracks,
  PLAYBACK_MODES,
} from '@/contract'
import { clientReturning, respond } from '@/test/apiClientFakes'

describe('playback calls', () => {
  it('checks the track list against the contract', async () => {
    const tracks: MediaTracks = {
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

  it("fetches a file's streams and checks them", async () => {
    const streams: MediaStreams = {
      video: {
        codec: 'h264',
        profile: 'High',
        bitrate: 11_100_000,
        range: 'sdr',
        isDolbyVisionOnly: false,
        dolbyVision: null,
      },
      audio: [
        {
          index: 0,
          codec: 'dts',
          profile: 'DTS-HD MA',
          channels: 6,
          bitrate: 1_509_000,
          sampleRate: 48_000,
        },
      ],
    }
    const { client, calls } = clientReturning(respond({ body: streams }))
    await expect(client.getStreams(7)).resolves.toEqual(streams)
    expect(calls[0]?.url).toBe('http://nas:8484/api/media/7/streams')
    const { client: broken } = clientReturning(
      respond({ body: { ...streams, video: { ...streams.video, range: 'hdr' } } }),
    )
    await expect(broken.getStreams(7)).rejects.toBeInstanceOf(ApiError)
  })

  it('fetches the media origins and checks them', async () => {
    const origins: MediaOrigin[] = [{ kind: 'lan', url: 'https://raven.home.example' }]
    const { client, calls } = clientReturning(respond({ body: { origins } }))
    await expect(client.getMediaOrigins()).resolves.toEqual({ origins, remote: null })
    expect(calls[0]?.url).toBe('http://nas:8484/api/media-origins')
    const { client: broken } = clientReturning(respond({ body: { origins: [{ kind: 'moon' }] } }))
    await expect(broken.getMediaOrigins()).rejects.toMatchObject({ status: 502 })
  })

  it('fetches a media ticket and checks it', async () => {
    const ticket = { ticket: 'abc.def', expiresAt: 1_700_000_000_000 }
    const { client, calls } = clientReturning(respond({ body: ticket }))
    await expect(client.getMediaTicket(7)).resolves.toEqual(ticket)
    expect(calls[0]?.url).toBe('http://nas:8484/api/media/7/ticket')
    const { client: broken } = clientReturning(respond({ body: { ticket: 'abc.def' } }))
    await expect(broken.getMediaTicket(7)).rejects.toMatchObject({ status: 502 })
  })

  it("points a speed probe at an origin's ping, a quarter of a MiB by default", () => {
    const { client } = clientReturning(respond({}))
    const origin: MediaOrigin = { kind: 'public', url: 'https://raven.example.com:8443' }
    expect(client.pingUrl({ origin })).toBe(
      `https://raven.example.com:8443/api/media-origins/ping?bytes=${MEDIA_PROBE_BYTES}`,
    )
    expect(client.pingUrl({ origin, bytes: 1000 })).toBe(
      'https://raven.example.com:8443/api/media-origins/ping?bytes=1000',
    )
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

  it('builds media URLs on the access origin with its ticket, and relative ones without', () => {
    const { client } = clientReturning(respond({}))
    const access = {
      origin: { kind: 'lan', url: 'https://raven.home.example' },
      ticket: 'abc.def',
    } as const satisfies MediaAccess
    expect(client.fileUrl({ id: 3, access })).toBe(
      'https://raven.home.example/api/media/3/file?t=abc.def',
    )
    expect(client.streamUrl({ id: 3, mode: 'remux', start: 0, audio: null, access })).toBe(
      'https://raven.home.example/api/media/3/stream?mode=remux&start=0&t=abc.def',
    )
    expect(client.streamUrl({ id: 3, mode: 'remux', start: 0, audio: 1, access })).toBe(
      'https://raven.home.example/api/media/3/stream?mode=remux&start=0&audio=1&t=abc.def',
    )
    expect(client.fileUrl({ id: 3, access: null })).toBe('http://nas:8484/api/media/3/file')
  })

  it('fetches subtitles from the access origin with the ticket', async () => {
    const vtt = 'WEBVTT\n\n05:01.000 --> 05:02.000\nHello'
    const { client, calls } = clientReturning(respond({ body: vtt }))
    const access = {
      origin: { kind: 'public', url: 'https://raven.away.example' },
      ticket: 'abc.def',
    } as const satisfies MediaAccess
    await client.getSubtitles({ id: 7, trackId: 'embedded-2', window: 1, access })
    expect(calls[0]?.url).toBe(
      'https://raven.away.example/api/media/7/subtitles/embedded-2?window=1&t=abc.def',
    )
  })

  it('addresses a sidecar whole, on the origin and ticket its picture plays by', () => {
    const { client } = clientReturning(respond({ body: '' }))
    const access = {
      origin: { kind: 'public', url: 'https://raven.away.example' },
      ticket: 'abc.def',
    } as const satisfies MediaAccess
    expect(client.sidecarSubtitlesUrl({ id: 7, trackId: 'external-0', access })).toBe(
      'https://raven.away.example/api/media/7/subtitles/external-0?t=abc.def',
    )
    expect(client.sidecarSubtitlesUrl({ id: 7, trackId: 'external-0' })).toMatch(
      /\/api\/media\/7\/subtitles\/external-0$/,
    )
  })

  it('builds HLS master URLs on the access origin, and relative ones without', () => {
    const { client } = clientReturning(respond({}))
    const access = {
      origin: { kind: MEDIA_ORIGIN_KINDS.lan, url: 'https://nas.local:8443' },
      ticket: 'abc',
    } as const satisfies MediaAccess
    expect(
      client.hlsUrl({ id: 7, mode: PLAYBACK_MODES.remux, audio: 1, quality: null, access }),
    ).toBe('https://nas.local:8443/api/media/7/hls/master.m3u8?mode=remux&audio=1&t=abc')
    expect(
      client.hlsUrl({
        id: 7,
        mode: PLAYBACK_MODES.transcode,
        audio: null,
        quality: 'low720',
        access: null,
      }),
    ).toBe('http://nas:8484/api/media/7/hls/master.m3u8?mode=transcode&quality=low720')
  })

  it('builds a transcode URL with the bitrate, on the origin access names with its ticket', () => {
    const { client } = clientReturning(respond({}))
    const access = {
      origin: { kind: MEDIA_ORIGIN_KINDS.lan, url: 'https://nas.local:8443' },
      ticket: 'abc.def',
    } as const satisfies MediaAccess
    expect(client.transcodeUrl({ mediaId: 7, kbps: 256, access })).toBe(
      'https://nas.local:8443/api/media/7/transcode?kbps=256&t=abc.def',
    )
    expect(client.transcodeUrl({ mediaId: 7, kbps: 128 })).toBe(
      'http://nas:8484/api/media/7/transcode?kbps=128',
    )
  })

  it('builds the device download copy URL on the origin access names with its ticket', () => {
    const { client } = clientReturning(respond({}))
    const access = {
      origin: { kind: MEDIA_ORIGIN_KINDS.lan, url: 'https://nas.local:8443' },
      ticket: 'abc.def',
    } as const satisfies MediaAccess
    expect(client.deviceDownloadFileUrl({ id: 7, access })).toBe(
      'https://nas.local:8443/api/media/7/device-download/file?t=abc.def',
    )
    expect(client.deviceDownloadFileUrl({ id: 7 })).toBe(
      'http://nas:8484/api/media/7/device-download/file',
    )
  })

  it('asks where the device download copy stands, and refuses an answer it does not know', async () => {
    const preparing = { state: DEVICE_DOWNLOAD_STATES.preparing, progress: 0.25 }
    const { client, calls } = clientReturning(respond({ body: preparing }))
    await expect(client.getDeviceDownload(7)).resolves.toEqual(preparing)
    expect(calls[0]?.url).toBe('http://nas:8484/api/media/7/device-download')
    const { client: confused } = clientReturning(respond({ body: { state: 'done' } }))
    await expect(confused.getDeviceDownload(7)).rejects.toThrow()
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
