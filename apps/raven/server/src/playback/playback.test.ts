import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { type ApiClient, type MediaItem, STREAM_TIME_SHIFT, type StreamMode } from '@raven/core'
import { CONTENT_TYPES, HEADERS } from '@shared/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { RAVEN_CONTENT_TYPES } from '@/http'
import { MediaIndex } from '@/media/mediaIndex'
import { SubtitlesService } from '@/playback/subtitlesService'
import { ScannerService } from '@/scanner/scannerService'
import { BROWSER_ENCODINGS, adminCookie, testConfig } from '@/test/app'
import { encodeRichClip } from '@/test/clips'
import { apiFor } from '@/test/server'

const run = promisify(execFile)

const CUES = [
  '1',
  '00:00:01,000 --> 00:00:03,000',
  'First <i>line</i>',
  '',
  '2',
  '00:00:12,500 --> 00:00:14,000',
  'Second line',
  '',
].join('\n')

const SIDECAR = ['1', '00:00:05,000 --> 00:00:06,000', 'Café forced', ''].join('\n')

/** First packet times of each stream in an MP4, as ffprobe reads them. */
const firstPacketTimes = async (path: string): Promise<{ video: number; audio: number }> => {
  const first = async (stream: string): Promise<number> => {
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      stream,
      '-show_entries',
      'packet=pts_time',
      '-read_intervals',
      '%+#1',
      '-of',
      'csv=p=0',
      path,
    ])
    return Number(stdout.trim().split('\n')[0])
  }
  return { video: await first('v:0'), audio: await first('a:0') }
}

/** Rounded to the millisecond, as WebVTT is. */
const ms = (seconds: number): number => Math.round(seconds * 1000) / 1000

/** As a browser with the admin lock off, so the library can be added and the settings changed. */
describe('playback', () => {
  const state: {
    root: string
    lead: number
    admin: string
    app: NestFastifyApplication | null
    movie: MediaItem | null
    pictures: MediaItem | null
  } = {
    root: '',
    /**
     * Where the server's clock puts the video's first frame. Usually 0, but
     * the clock counts from the file's earliest packet, and ffmpeg 6 reads
     * the test clip's AAC priming as starting 23ms before the video
     * (ffmpeg 9 does not). Subtitles and streams share that clock, which is
     * what the player needs, so expectations are measured from here.
     */
    lead: 0,
    admin: '',
    app: null,
    movie: null,
    pictures: null,
  }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const api = (): ApiClient => apiFor({ app: app(), cookie: state.admin })
  const movieId = (): number => state.movie?.id ?? -1
  const picturesId = (): number => state.pictures?.id ?? -1
  type StreamUrlProps = {
    mode: StreamMode
    start?: number
    audio?: number | null
  }

  /** A converted stream's address, built as the player builds it. */
  const streamUrl = ({ mode, start = 0, audio = null }: StreamUrlProps) =>
    api().streamUrl({ id: movieId(), mode, start, audio })

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-playback-'))
    const media = join(state.root, 'media')
    await encodeRichClip({ path: join(media, 'Rich (2026).mkv'), cues: CUES })
    // The same clip with its English cues as a picture track (PGS), which only a burn can show.
    await encodeRichClip({
      path: join(media, 'Rich Pictures (2026).mkv'),
      seconds: 12,
      cues: CUES,
      isPictureSubtitle: true,
    })
    // Latin-1 rather than UTF-8, as plenty of old sidecars are.
    await writeFile(join(media, 'Rich (2026).en.forced.srt'), Buffer.from(SIDECAR, 'latin1'))
    state.app = await createApp({
      config: testConfig({ dataDir: join(state.root, 'data'), mediaDir: media }),
      quiet: true,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    state.admin = await adminCookie(state.app)
    const library = await api().createLibrary({ name: 'Films', paths: [media] })
    await app().get(ScannerService).whenIdle(library.id)
    const listed = await api().listMedia({ libraryId: library.id })
    const movie = listed.find((item) => item.fileName === 'Rich (2026).mkv')
    const pictures = listed.find((item) => item.fileName === 'Rich Pictures (2026).mkv')
    if (!movie || !pictures) throw new Error('nothing indexed')
    state.movie = movie
    state.pictures = pictures
    const fromTop = await app().inject({ method: 'GET', url: streamUrl({ mode: 'remux' }) })
    const top = join(state.root, 'top.mp4')
    await writeFile(top, fromTop.rawPayload)
    state.lead = (await firstPacketTimes(top)).video - STREAM_TIME_SHIFT
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('lists the audio and subtitle tracks, sidecars included', async () => {
    const tracks = await api().getTracks(movieId())
    expect(
      tracks.audio.map(({ index, codec, language, title, default: flagged }) => ({
        index,
        codec,
        language,
        title,
        flagged,
      })),
    ).toEqual([
      { index: 0, codec: 'ac3', language: 'en', title: null, flagged: true },
      { index: 1, codec: 'aac', language: 'ja', title: 'Commentary', flagged: false },
    ])
    expect(tracks.defaultAudio).toBe(0)
    expect(tracks.frameRate).toBe(24)
    expect(tracks.subtitles).toEqual([
      expect.objectContaining({
        id: 'embedded-0',
        codec: 'subrip',
        language: 'en',
        supported: true,
      }),
      expect.objectContaining({
        id: 'external-0',
        source: 'external',
        language: 'en',
        forced: true,
      }),
    ])
  })

  it("reads the file's picture and sound in detail, and 404s for media it does not have", async () => {
    const streams = await api().getStreams(movieId())
    expect(streams.video).toMatchObject({ codec: 'h264', profile: 'High', range: 'sdr' })
    expect(streams.audio).toEqual([
      expect.objectContaining({ index: 0, codec: 'ac3', channels: 1, sampleRate: 44_100 }),
      expect.objectContaining({ index: 1, codec: 'aac', profile: 'LC', sampleRate: 44_100 }),
    ])
    await expect(api().getStreams(movieId() + 1000)).rejects.toMatchObject({ status: 404 })
  })

  it('serves an embedded track window as WebVTT on the file clock', async () => {
    const response = await app().inject({
      method: 'GET',
      url: `/api/media/${movieId()}/subtitles/embedded-0?window=0`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers[HEADERS.contentType]).toContain(CONTENT_TYPES.vtt)
    const cues = await api().getSubtitles({ id: movieId(), trackId: 'embedded-0', window: 0 })
    // The source SRT's times, on the same clock as the server's streams.
    expect(
      cues.map((cue) => ({
        ...cue,
        start: ms(cue.start - state.lead),
        end: ms(cue.end - state.lead),
      })),
    ).toEqual([
      { start: 1, end: 3, text: 'First <i>line</i>' },
      { start: 12.5, end: 14, text: 'Second line' },
    ])
    // The next window is past the end of a 30 second clip: empty, not an error.
    expect(await api().getSubtitles({ id: movieId(), trackId: 'embedded-0', window: 1 })).toEqual(
      [],
    )
  })

  it('converts a sidecar, falling back from UTF-8', async () => {
    expect(await api().getSubtitles({ id: movieId(), trackId: 'external-0' })).toEqual([
      { start: 5, end: 6, text: 'Café forced' },
    ])
  })

  it('refuses unsafe subtitle cache names before looking up tracks', async () => {
    const file = app().get(MediaIndex).fileOf(movieId())
    if (!file) throw new Error('nothing indexed')
    const service = app().get(SubtitlesService)
    await Promise.all(
      ['../../outside', 'external-0/../../../outside', 'embedded-0\\..\\outside'].map((trackId) =>
        expect(service.vtt({ file, trackId, window: 0 })).rejects.toThrow(),
      ),
    )
    await Promise.all(
      [-1, NaN, Infinity, 0.5].map((window) =>
        expect(service.vtt({ file, trackId: 'embedded-0', window })).rejects.toThrow(),
      ),
    )
  })

  it('refuses unknown tracks and bad windows', async () => {
    await expect(
      api().getSubtitles({ id: movieId(), trackId: 'embedded-9' }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      api().getSubtitles({ id: movieId(), trackId: 'embedded-0', window: -1 }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('refuses a converted stream while Settings have conversion off, and again after', async () => {
    const turn = (transcoding: 'on' | 'remuxOnly' | 'off') =>
      api().setPlaybackSettings({ transcoding })
    await turn('off')
    const off = await app().inject({ method: 'GET', url: streamUrl({ mode: 'remux' }) })
    expect(off.statusCode).toBe(403)
    await turn('remuxOnly')
    const noTranscode = await app().inject({ method: 'GET', url: streamUrl({ mode: 'transcode' }) })
    expect(noTranscode.statusCode).toBe(403)
    await turn('on')
  })

  describe('converted streams', () => {
    /**
     * A stream is binary and endless to a player, so a test reads it by hand,
     * offering compression as a browser does: video is sent as it is.
     */
    const fetchStream = async (url: string): Promise<string> => {
      const response = await app().inject({
        method: 'GET',
        url,
        headers: { [HEADERS.acceptEncoding]: BROWSER_ENCODINGS },
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers[HEADERS.contentType]).toBe(RAVEN_CONTENT_TYPES.mp4)
      expect(response.headers[HEADERS.contentEncoding]).toBeUndefined()
      expect(response.rawPayload.subarray(4, 8).toString()).toBe('ftyp')
      const path = join(state.root, `stream-${Math.random().toString(36).slice(2)}.mp4`)
      await writeFile(path, response.rawPayload)
      return path
    }

    it('starts a remux on the file clock, shifted, from the keyframe before the start', async () => {
      const times = await firstPacketTimes(
        await fetchStream(streamUrl({ mode: 'remux', start: 12, audio: 1 })),
      )
      const video = times.video - STREAM_TIME_SHIFT - state.lead
      // Keyframes fall every two seconds from the video's start; ffmpeg
      // starts at one before the target.
      expect(video).toBeGreaterThanOrEqual(8)
      expect(video).toBeLessThanOrEqual(12)
      expect(Number.isInteger(ms(video))).toBe(true)
      expect(times.audio - STREAM_TIME_SHIFT).toBeGreaterThan(7.9)
    })

    it('starts at the shift itself from the top of the file', async () => {
      const times = await firstPacketTimes(await fetchStream(streamUrl({ mode: 'transcode' })))
      expect(times.video).toBeCloseTo(STREAM_TIME_SHIFT + state.lead, 1)
      expect(times.audio).toBeGreaterThan(0)
    })

    describe('with a picture subtitle burned in', () => {
      type BurnUrlProps = { start?: number }
      const burnUrl = ({ start = 0 }: BurnUrlProps = {}) =>
        api().streamUrl({
          id: picturesId(),
          mode: 'transcode',
          start,
          audio: null,
          burn: 'embedded-0',
        })
      type PlainUrlProps = { start?: number }
      const plainUrl = ({ start = 0 }: PlainUrlProps = {}) =>
        api().streamUrl({ id: picturesId(), mode: 'transcode', start, audio: null })

      /** How alike two streams' frames are `seconds` into the file (`-ss` counts from the stream's start): PSNR in dB, high for alike. */
      type LikenessProps = { a: string; b: string; seconds: number }
      const likeness = async ({ a, b, seconds }: LikenessProps) => {
        const { stderr } = await run('ffmpeg', [
          '-hide_banner',
          '-ss',
          String(seconds),
          '-i',
          a,
          '-ss',
          String(seconds),
          '-i',
          b,
          '-frames:v',
          '1',
          '-lavfi',
          '[0:v][1:v]psnr',
          '-f',
          'null',
          '-',
        ])
        const found = /average:(\S+)/.exec(stderr)?.[1]
        return found === 'inf' ? Infinity : Number(found)
      }

      it('draws the subtitle while it is up and not before or after', async () => {
        const burned = await fetchStream(burnUrl())
        const plain = await fetchStream(plainUrl())
        // The first box is up from 1 s to 3 s; its white box at the foot is a visible change.
        expect(await likeness({ a: burned, b: plain, seconds: 2 })).toBeLessThan(30)
        // Between the two boxes only the encoder's own noise differs.
        expect(await likeness({ a: burned, b: plain, seconds: 5 })).toBeGreaterThan(35)
      })

      it('keeps the file clock after a seek, as a stream without a burn does', async () => {
        const burned = await firstPacketTimes(await fetchStream(burnUrl({ start: 4 })))
        const plain = await firstPacketTimes(await fetchStream(plainUrl({ start: 4 })))
        expect(burned.video).toBeCloseTo(plain.video, 1)
        expect(burned.audio).toBeCloseTo(plain.audio, 1)
      })

      it('refuses a burn that is not a picture track of a transcode', async () => {
        const statuses = await Promise.all(
          [
            `${picturesId()}/stream?mode=remux&burn=embedded-0`,
            `${picturesId()}/stream?mode=transcode&burn=embedded-9`,
            // The rich clip's own subtitle is text, a rendition of its own.
            `${movieId()}/stream?mode=transcode&burn=embedded-0`,
          ].map(
            async (path) =>
              (await app().inject({ method: 'GET', url: `/api/media/${path}` })).statusCode,
          ),
        )
        expect(statuses).toEqual([400, 400, 400])
      })
    })

    // Addresses the client would never build, so written by hand.
    it('rejects a bad mode, start, audio track or quality', async () => {
      const statuses = await Promise.all(
        [
          'mode=burn',
          'mode=remux&start=soon',
          'mode=remux&audio=7',
          'mode=transcode&quality=huge',
          'mode=remux&quality=sd480',
        ].map(
          async (query) =>
            (await app().inject({ method: 'GET', url: `/api/media/${movieId()}/stream?${query}` }))
              .statusCode,
        ),
      )
      expect(statuses).toEqual([400, 400, 400, 400, 400])
    })
  })
})
