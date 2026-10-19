import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  HLS_PARAMS,
  HLS_PATHS,
  MEDIA_TICKET_PARAM,
  PLAYBACK_MODES,
  STREAM_TIME_SHIFT,
  type StreamMode,
  TRANSCODINGS,
  parseWebVtt,
  toQueryString,
} from '@raven/core'
import { CONTENT_TYPES, HEADERS } from '@shared/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '@/app'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { RAVEN_CONTENT_TYPES } from '@/http'
import { MediaIndex } from '@/media/mediaIndex'
import { MediaTickets } from '@/media/mediaTickets'
import { ScannerService } from '@/scanner/scannerService'
import {
  BROWSER_ENCODINGS,
  NOT_WATCHING,
  adminCookie,
  cookieSet,
  cookies,
  decodedBody,
  testConfig,
} from '@/test/app'
import { encodeClip, encodeRichClip } from '@/test/clips'
import { apiFor } from '@/test/server'

const run = promisify(execFile)

const PIN = '2468'

const CUES = [
  '1',
  '00:00:01,000 --> 00:00:03,000',
  'First line',
  '',
  '2',
  '00:00:12,500 --> 00:00:14,000',
  'Second line',
  '',
].join('\n')

/** Sidecar cues for the clip whose clock starts at 2.5 s: one in each of its first two segments. */
const LATE_SIDECAR = [
  '1',
  '00:00:01,000 --> 00:00:02,000',
  'Early',
  '',
  '2',
  '00:00:07,000 --> 00:00:08,000',
  'Later',
  '',
].join('\n')

const LATE_START = 2.5

/** How long the late-starting clip's picture runs. */
const LATE_SECONDS = 12

type Transcoding = (typeof TRANSCODINGS)[keyof typeof TRANSCODINGS]

const FILES = {
  rich: 'Rich (2026).mkv',
  gap: 'Gap (2026).mp4',
  late: 'Late (2026).mkv',
  warm: 'Warm (2026).mp4',
  broadcast: 'Broadcast (2026).ts',
} as const

type Clip = keyof typeof FILES

/** The playlist's URIs: every line that is not a tag, and every tag's `URI` attribute. */
const urisIn = (playlist: string): string[] =>
  playlist
    .split('\n')
    .flatMap((line) =>
      line.startsWith('#')
        ? [...line.matchAll(/URI="([^"]+)"/g)].flatMap((match) => match[1] ?? [])
        : line.trim() === ''
          ? []
          : [line],
    )

const extinfsIn = (playlist: string): number[] =>
  [...playlist.matchAll(/^#EXTINF:([\d.]+),$/gm)].map((match) => Number(match[1]))

const attributeOf = ({ playlist, name }: { playlist: string; name: string }): string | null =>
  new RegExp(`${name}=("[^"]*"|[^,\\n]*)`).exec(playlist)?.[1]?.replace(/"/g, '') ?? null

const ffprobe = async ({ path, args }: { path: string; args: string[] }): Promise<string> =>
  (await run('ffprobe', ['-v', 'error', ...args, '-of', 'csv=p=0', path])).stdout.trim()

describe('the HLS route', () => {
  const state: {
    root: string
    app: NestFastifyApplication | null
    admin: string
    unlocked: string
    ids: Record<Clip, number>
  } = {
    root: '',
    app: null,
    admin: '',
    unlocked: '',
    ids: { rich: 0, gap: 0, late: 0, warm: 0, broadcast: 0 },
  }

  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const ticketFor = (id: number): string => app().get(MediaTickets).issue({ id }).ticket

  const get = ({ url, cookie }: { url: string; cookie?: string }) =>
    app().inject({
      method: 'GET',
      url,
      headers: {
        [HEADERS.acceptEncoding]: BROWSER_ENCODINGS,
        ...(cookie == null ? {} : { cookie }),
      },
    })

  const masterUrl = ({
    clip,
    mode,
    ticket = ticketFor(state.ids[clip]),
    query = {},
  }: {
    clip: Clip
    mode: StreamMode
    ticket?: string | null
    query?: Record<string, string>
  }): string => {
    const path = HLS_PATHS.master.replace(`:${HLS_PARAMS.id}`, String(state.ids[clip]))
    const params = {
      [HLS_PARAMS.mode]: mode,
      ...query,
      ...(ticket == null ? {} : { [MEDIA_TICKET_PARAM]: ticket }),
    }
    return `${path}?${toQueryString(params)}`
  }

  /** The master playlist and the URIs in it, asked for with a ticket. */
  const master = async ({ clip, mode }: { clip: Clip; mode: StreamMode }) => {
    const response = await get({ url: masterUrl({ clip, mode }) })
    expect(response.statusCode).toBe(200)
    const playlist = decodedBody(response).toString()
    return { playlist, uris: urisIn(playlist) }
  }

  const playlistAt = async (uri: string) => {
    const response = await get({ url: uri })
    expect(response.statusCode).toBe(200)
    expect(response.headers[HEADERS.contentType]).toBe(CONTENT_TYPES.m3u8)
    const playlist = decodedBody(response).toString()
    return { response, playlist, uris: urisIn(playlist) }
  }

  const videoPlaylist = async ({ clip, mode }: { clip: Clip; mode: StreamMode }) => {
    const { uris } = await master({ clip, mode })
    const variant = uris.find((uri) => uri.includes('/video.m3u8')) ?? ''
    return playlistAt(variant)
  }

  const setTranscoding = (transcoding: Transcoding) =>
    apiFor({ app: app(), cookie: state.admin }).setPlaybackSettings({ transcoding })

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-hls-app-'))
    const media = join(state.root, 'media')
    // The sidecar is written beside clips still being encoded, which make the folder only as they start.
    await mkdir(media, { recursive: true })
    await Promise.all([
      // A minute: ten segments, so the video playlist is long enough to be compressed.
      encodeRichClip({ path: join(media, FILES.rich), seconds: 60, cues: CUES }),
      encodeClip({ path: join(media, FILES.gap), seconds: 30, keyframeEvery: 25 }),
      // AC-3, which has no priming to pull the clock's start before 2.5 s.
      encodeClip({
        path: join(media, FILES.late),
        seconds: LATE_SECONDS,
        audio: 'ac3',
        startAt: LATE_START,
      }),
      writeFile(join(media, 'Late (2026).en.srt'), LATE_SIDECAR),
      encodeClip({ path: join(media, FILES.warm), seconds: 2 }),
      encodeClip({ path: join(media, FILES.broadcast), seconds: 12, startAt: 10 }),
    ])
    state.app = await createApp({
      config: {
        ...testConfig({ dataDir: join(state.root, 'data'), mediaDir: media }),
        mediaPlane: {
          origins: [],
          webOrigins: [],
          secret: randomBytes(32),
          problems: [],
          secretProblems: [],
        },
        libraryPin: PIN,
      },
      quiet: true,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    state.admin = await adminCookie(state.app)
    const library = await apiFor({ app: state.app, cookie: state.admin }).createLibrary({
      name: 'Vault',
      paths: [media],
      settings: { locked: true },
    })
    await state.app.get(ScannerService).whenIdle(library.id)
    const index = state.app.get(MediaIndex)
    const idOf = (clip: Clip): number => {
      const id = index
        .idsForLibrary(library.id)
        .find((candidate) => index.fileOf(candidate)?.fileName === FILES[clip])
      if (id == null) throw new Error(`${FILES[clip]} was not scanned`)
      return id
    }
    state.ids = {
      rich: idOf('rich'),
      gap: idOf('gap'),
      late: idOf('late'),
      warm: idOf('warm'),
      broadcast: idOf('broadcast'),
    }
    const unlock = await state.app.inject({
      method: 'POST',
      url: '/api/lock/unlock',
      payload: { pin: PIN },
    })
    state.unlocked = cookies(state.admin, cookieSet(unlock))
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('opens a remux with one variant, and carries the ticket on every URI', async () => {
    const ticket = ticketFor(state.ids.rich)
    const response = await get({
      url: masterUrl({ clip: 'rich', mode: PLAYBACK_MODES.remux, ticket }),
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers[HEADERS.contentType]).toBe(CONTENT_TYPES.m3u8)
    const playlist = decodedBody(response).toString()
    expect(playlist.match(/#EXT-X-STREAM-INF/g)).toHaveLength(1)
    expect(attributeOf({ playlist, name: 'CODECS' })).toBe('avc1.640028,ac-3')
    expect(attributeOf({ playlist, name: 'RESOLUTION' })).toBe('320x240')
    expect(Number(attributeOf({ playlist, name: 'BANDWIDTH' }))).toBeGreaterThan(0)
    expect(playlist).not.toContain('#EXT-X-INDEPENDENT-SEGMENTS')
    const uris = urisIn(playlist)
    // The embedded SRT's rendition, then the variant.
    expect(uris).toHaveLength(2)
    uris.forEach((uri) => {
      expect(uri.startsWith(`/api/media/${state.ids.rich}/hls/`)).toBe(true)
      expect(uri).toContain(`${MEDIA_TICKET_PARAM}=${encodeURIComponent(ticket)}`)
    })

    const variant = await playlistAt(uris[1] ?? '')
    expect(variant.uris.length).toBeGreaterThan(2)
    variant.uris.forEach((uri) =>
      expect(uri).toContain(`${MEDIA_TICKET_PARAM}=${encodeURIComponent(ticket)}`),
    )
  })

  it('carries no ticket on the URIs of a playlist asked for with the cookie', async () => {
    const response = await get({
      url: masterUrl({ clip: 'rich', mode: PLAYBACK_MODES.remux, ticket: null }),
      cookie: state.unlocked,
    })
    expect(response.statusCode).toBe(200)
    const uris = urisIn(decodedBody(response).toString())
    expect(uris.length).toBeGreaterThan(0)
    uris.forEach((uri) => expect(uri).not.toContain('?'))
  })

  it("lists segments whose durations add up to the file's, behind its init", async () => {
    const { playlist, uris } = await videoPlaylist({ clip: 'rich', mode: PLAYBACK_MODES.remux })
    const path = join(state.root, 'media', FILES.rich)
    const [format, firstKeyframe] = await Promise.all([
      ffprobe({ path, args: ['-show_entries', 'format=start_time,duration'] }),
      ffprobe({
        path,
        args: [
          '-select_streams',
          'v:0',
          '-show_entries',
          'packet=pts_time',
          '-read_intervals',
          '%+#1',
        ],
      }),
    ])
    // Matroska counts its duration from 0 on its own clock, wherever the file starts.
    const [, duration = NaN] = format.split(',').map(Number)
    const total = extinfsIn(playlist).reduce((sum, seconds) => sum + seconds, 0)

    expect(total).toBeCloseTo(duration - Number(firstKeyframe), 2)
    expect(playlist).toContain('#EXT-X-PLAYLIST-TYPE:VOD')
    expect(playlist).toContain('#EXT-X-ENDLIST')
    expect(uris[0]).toContain('/init')
    expect(uris.slice(1).every((uri, n) => uri.includes(`/segment/${n}`))).toBe(true)
  })

  it('serves an init and segments that ffprobe reads, never compressed', async () => {
    const { uris } = await videoPlaylist({ clip: 'rich', mode: PLAYBACK_MODES.remux })
    const [init, first, second] = await Promise.all(
      uris.slice(0, 3).map((uri) => get({ url: uri })),
    )

    expect(init?.statusCode).toBe(200)
    expect(init?.headers[HEADERS.contentType]).toBe(RAVEN_CONTENT_TYPES.mp4)
    expect(init?.rawPayload.subarray(4, 8).toString()).toBe('ftyp')
    ;[first, second].forEach((segment) => {
      expect(segment?.statusCode).toBe(200)
      expect(segment?.headers[HEADERS.contentType]).toBe(RAVEN_CONTENT_TYPES.segment)
      expect(segment?.rawPayload.subarray(4, 8).toString()).toBe('moof')
    })
    ;[init, first, second].forEach((response) =>
      expect(response?.headers[HEADERS.contentEncoding]).toBeUndefined(),
    )
    const path = join(state.root, 'segments.mp4')
    await writeFile(
      path,
      Buffer.concat(
        [init?.rawPayload, first?.rawPayload, second?.rawPayload].flatMap((b) => b ?? []),
      ),
    )
    const [codec, firstPts] = await Promise.all([
      ffprobe({ path, args: ['-select_streams', 'v:0', '-show_entries', 'stream=codec_name'] }),
      ffprobe({
        path,
        args: [
          '-select_streams',
          'v:0',
          '-show_entries',
          'packet=pts_time',
          '-read_intervals',
          '%+#1',
        ],
      }),
    ])
    expect(codec).toBe('h264')
    expect(Number(firstPts)).toBeCloseTo(STREAM_TIME_SHIFT, 1)
  })

  it('compresses a playlist but no media', async () => {
    const { response } = await videoPlaylist({ clip: 'rich', mode: PLAYBACK_MODES.remux })
    expect(response.headers[HEADERS.contentEncoding]).toBeDefined()
  })

  it('opens a transcode to H.264 whose segments are independent', async () => {
    const { playlist, uris } = await master({ clip: 'rich', mode: PLAYBACK_MODES.transcode })
    expect(playlist).toContain('#EXT-X-INDEPENDENT-SEGMENTS')
    expect(attributeOf({ playlist, name: 'CODECS' })).toBe('avc1.640028,ac-3')
    const variant = await playlistAt(uris.find((uri) => uri.includes('/video.m3u8')) ?? '')
    const segment = await get({ url: variant.uris[1] ?? '' })
    expect(segment.statusCode).toBe(200)
    expect(segment.rawPayload.subarray(4, 8).toString()).toBe('moof')
  })

  it('names the codec of the audio track asked for', async () => {
    const aac = await get({
      url: masterUrl({
        clip: 'rich',
        mode: PLAYBACK_MODES.remux,
        query: { [HLS_PARAMS.audio]: '1' },
      }),
    })
    expect(attributeOf({ playlist: decodedBody(aac).toString(), name: 'CODECS' })).toBe(
      'avc1.640028,mp4a.40.2',
    )
  })

  it('refuses a bad mode, audio track or quality with 400', async () => {
    const asked = await Promise.all(
      [
        masterUrl({
          clip: 'rich',
          mode: PLAYBACK_MODES.remux,
          query: { [HLS_PARAMS.mode]: PLAYBACK_MODES.direct },
        }),
        masterUrl({ clip: 'rich', mode: PLAYBACK_MODES.remux, query: { [HLS_PARAMS.audio]: '7' } }),
        masterUrl({
          clip: 'rich',
          mode: PLAYBACK_MODES.remux,
          query: { [HLS_PARAMS.quality]: 'low720' },
        }),
        masterUrl({
          clip: 'rich',
          mode: PLAYBACK_MODES.transcode,
          query: { [HLS_PARAMS.quality]: 'huge' },
        }),
      ].map((url) => get({ url })),
    )
    expect(asked.map(({ statusCode }) => statusCode)).toEqual([400, 400, 400, 400])
  })

  it('refuses what the settings turn off with 403', async () => {
    const statuses = async () =>
      Promise.all(
        [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode].map(
          async (mode) => (await get({ url: masterUrl({ clip: 'rich', mode }) })).statusCode,
        ),
      )
    try {
      await setTranscoding(TRANSCODINGS.off)
      expect(await statuses()).toEqual([403, 403])
      await setTranscoding(TRANSCODINGS.remuxOnly)
      expect(await statuses()).toEqual([200, 403])
    } finally {
      await setTranscoding(TRANSCODINGS.on)
    }
  })

  it("lists a late-starting file's segments as long as its media, not its clock", async () => {
    const { playlist } = await videoPlaylist({ clip: 'late', mode: PLAYBACK_MODES.remux })
    const total = extinfsIn(playlist).reduce((sum, seconds) => sum + seconds, 0)
    expect(total).toBeCloseTo(LATE_SECONDS, 1)
  })

  it('transcodes a late-starting file from its first frame, and again from a later segment', async () => {
    /** Segment `n` of a new transcode session, asked for first, as ffprobe reads it after its init. */
    const segmentOf = async (n: number) => {
      const { uris } = await videoPlaylist({ clip: 'late', mode: PLAYBACK_MODES.transcode })
      const [init, segment] = await Promise.all(
        [uris[0] ?? '', uris[n + 1] ?? ''].map((uri) => get({ url: uri })),
      )
      const path = join(state.root, `late-transcode-${n}.mp4`)
      await writeFile(
        path,
        Buffer.concat([init?.rawPayload, segment?.rawPayload].flatMap((b) => b ?? [])),
      )
      const pts = (
        await ffprobe({
          path,
          args: ['-select_streams', 'v:0', '-show_entries', 'packet=pts_time'],
        })
      )
        .split('\n')
        .map(Number)
      return { first: Math.min(...pts), count: pts.length }
    }
    const [first, second] = await Promise.all([segmentOf(0), segmentOf(1)])

    // Six seconds at 24 fps from the picture's start, then six more from a run of their own.
    expect(first).toEqual({ first: LATE_START + STREAM_TIME_SHIFT, count: 144 })
    expect(second.first).toBeCloseTo(LATE_START + 6 + STREAM_TIME_SHIFT, 3)
    expect(second.count).toBe(144)
  })

  it('starts the keyframe probe once when the tracks are read, and does not wait for it', async () => {
    const probe: { finish: (keyframes: number[]) => void } = { finish: () => undefined }
    const spy = vi.spyOn(app().get(FfmpegService), 'probeKeyframes').mockImplementation(
      () =>
        new Promise<number[]>((resolve) => {
          probe.finish = resolve
        }),
    )
    try {
      const url = `/api/media/${state.ids.warm}/tracks`
      const [first, second] = [
        await get({ url, cookie: state.unlocked }),
        await get({ url, cookie: state.unlocked }),
      ]

      expect([first.statusCode, second.statusCode]).toEqual([200, 200])
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith(join(state.root, 'media', FILES.warm))
    } finally {
      probe.finish([0])
      spy.mockRestore()
    }
  })

  it("opens a transport stream's transcode whose keyframe probe fails", async () => {
    const spy = vi
      .spyOn(app().get(FfmpegService), 'probeKeyframes')
      .mockRejectedValue(new Error('ffprobe could not read the file'))
    try {
      const response = await get({
        url: masterUrl({ clip: 'broadcast', mode: PLAYBACK_MODES.transcode }),
      })

      expect(response.statusCode).toBe(200)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })

  it("opens a transport stream's transcode without waiting for its keyframe probe", async () => {
    const probe: { finish: (keyframes: number[]) => void } = { finish: () => undefined }
    const spy = vi.spyOn(app().get(FfmpegService), 'probeKeyframes').mockImplementation(
      () =>
        new Promise<number[]>((resolve) => {
          probe.finish = resolve
        }),
    )
    try {
      const response = await get({
        url: masterUrl({ clip: 'broadcast', mode: PLAYBACK_MODES.transcode }),
      })

      expect(response.statusCode).toBe(200)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      probe.finish([])
      spy.mockRestore()
    }
  })

  it('answers 409 to a remux of a file with keyframes 25 seconds apart, and transcodes it', async () => {
    const remux = await get({ url: masterUrl({ clip: 'gap', mode: PLAYBACK_MODES.remux }) })
    const transcode = await get({ url: masterUrl({ clip: 'gap', mode: PLAYBACK_MODES.transcode }) })
    expect([remux.statusCode, transcode.statusCode]).toEqual([409, 200])
  })

  it('answers 404 to a session or segment that is not there', async () => {
    const { uris } = await videoPlaylist({ clip: 'rich', mode: PLAYBACK_MODES.remux })
    const segment = uris[1] ?? ''
    const session = /\/hls\/([^/]+)\//.exec(segment)?.[1] ?? ''
    const ticket = `?${MEDIA_TICKET_PARAM}=${encodeURIComponent(ticketFor(state.ids.rich))}`
    const base = `/api/media/${state.ids.rich}/hls`
    const otherTicket = `?${MEDIA_TICKET_PARAM}=${encodeURIComponent(ticketFor(state.ids.late))}`
    const asked = await Promise.all(
      [
        `${base}/not-a-session/video.m3u8${ticket}`,
        `${base}/${'A'.repeat(22)}/video.m3u8${ticket}`,
        `${base}/${'A'.repeat(22)}/segment/0${ticket}`,
        `${base}/${session}/segment/99${ticket}`,
        `${base}/${session}/segment/one${ticket}`,
        `${base}/${session}/segment/-1${ticket}`,
        `${base}/${session}/subtitles/embedded-9${ticket}`,
        `${base}/${session}/subtitles/embedded-0/99${ticket}`,
        // A session of one video is not another's.
        `/api/media/${state.ids.late}/hls/${session}/video.m3u8${otherTicket}`,
      ].map((url) => get({ url })),
    )
    expect(asked.map(({ statusCode }) => statusCode)).toEqual(asked.map(() => 404))
  })

  it('refuses a ticket for another video: 423, or 404 under the admin lock', async () => {
    const wrong = ticketFor(state.ids.gap)
    const url = masterUrl({ clip: 'rich', mode: PLAYBACK_MODES.remux, ticket: wrong })
    expect((await get({ url, cookie: state.admin })).statusCode).toBe(423)
    expect((await get({ url })).statusCode).toBe(404)
  })

  it("serves a sidecar's cues six seconds at a time, on the file's own clock", async () => {
    const { playlist, uris } = await master({ clip: 'late', mode: PLAYBACK_MODES.remux })
    expect(playlist).toContain('#EXT-X-MEDIA:TYPE=SUBTITLES')
    const subtitles = await playlistAt(
      uris.find((uri) => uri.includes('/subtitles/external-0')) ?? '',
    )
    expect(subtitles.playlist).toContain(`#EXT-X-TARGETDURATION:6`)

    const [first, second] = await Promise.all(
      subtitles.uris.slice(0, 2).map((uri) => get({ url: uri })),
    )
    const texts = [first, second].map((response) => {
      expect(response?.statusCode).toBe(200)
      expect(response?.headers[HEADERS.contentType]).toBe(CONTENT_TYPES.vtt)
      return response ? decodedBody(response).toString() : ''
    })
    texts.forEach((text) =>
      expect(text).toContain(
        `X-TIMESTAMP-MAP=MPEGTS:${STREAM_TIME_SHIFT * 90_000},LOCAL:00:00:00.000`,
      ),
    )
    // Each cue at its time in the sidecar plus where the file's clock starts:
    // 2.5 s, or a few milliseconds before where an encoder's AC-3 starts early.
    const start = Number(
      await ffprobe({
        path: join(state.root, 'media', FILES.late),
        args: ['-show_entries', 'format=start_time'],
      }),
    )
    expect(start).toBeCloseTo(LATE_START, 1)
    const [early, later] = texts.map(parseWebVtt)
    expect(early?.map(({ text }) => text)).toEqual(['Early'])
    expect(early?.[0]?.start).toBeCloseTo(1 + start, 3)
    expect(early?.[0]?.end).toBeCloseTo(2 + start, 3)
    expect(later?.map(({ text }) => text)).toEqual(['Later'])
    expect(later?.[0]?.start).toBeCloseTo(7 + start, 3)
  })

  it("cuts an embedded track's window into the segment's six seconds", async () => {
    const { uris } = await master({ clip: 'rich', mode: PLAYBACK_MODES.remux })
    const subtitles = await playlistAt(
      uris.find((uri) => uri.includes('/subtitles/embedded-0')) ?? '',
    )
    const third = await get({ url: subtitles.uris[2] ?? '' })
    const cues = parseWebVtt(decodedBody(third).toString())
    // The cue is 12.5 s after the first frame, wherever the muxer that wrote the clip put that.
    const firstFrame = await ffprobe({
      path: join(state.root, 'media', FILES.rich),
      args: [
        '-select_streams',
        'v:0',
        '-show_entries',
        'packet=pts_time',
        '-read_intervals',
        '%+#1',
      ],
    })
    expect(cues.map(({ text }) => text)).toEqual(['Second line'])
    expect(cues[0]?.start).toBeCloseTo(12.5 + Number(firstFrame), 3)
  })
})
