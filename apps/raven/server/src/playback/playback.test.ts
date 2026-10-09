import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  type MediaItem,
  STREAM_TIME_SHIFT,
  isLibrary,
  isMediaList,
  isMediaTracks,
  parseWebVtt,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { readServerConfig } from '@/config'
import { ScannerService } from '@/scanner/scannerService'
import { encodeRichClip } from '@/test/clips'

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

describe('playback', () => {
  const state = {
    root: '',
    /**
     * Where the server's clock puts the video's first frame. Usually 0, but
     * the clock counts from the file's earliest packet, and ffmpeg 6 reads
     * the test clip's AAC priming as starting 23ms before the video
     * (ffmpeg 9 does not). Subtitles and streams share that clock, which is
     * what the player needs, so expectations are measured from here.
     */
    lead: 0,
    app: null as NestFastifyApplication | null,
    movie: null as MediaItem | null,
  }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const movieId = (): number => state.movie?.id ?? -1

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-playback-'))
    const media = join(state.root, 'media')
    await encodeRichClip({ path: join(media, 'Rich (2026).mkv'), cues: CUES })
    // Latin-1 rather than UTF-8, as plenty of old sidecars are.
    await writeFile(join(media, 'Rich (2026).en.forced.srt'), Buffer.from(SIDECAR, 'latin1'))
    state.app = await createApp({
      config: {
        ...readServerConfig({}),
        dataDir: join(state.root, 'data'),
        webDir: null,
        browseRoot: media,
        scanOnStart: false,
        rescanIntervalMinutes: 0,
      },
      quiet: true,
    })
    await state.app.init()
    await state.app.getHttpAdapter().getInstance().ready()
    const created = await state.app.inject({
      method: 'POST',
      url: '/api/libraries',
      payload: { name: 'Films', paths: [media] },
    })
    const library: unknown = created.json()
    if (!isLibrary(library)) throw new Error(created.body)
    await state.app.get(ScannerService).whenIdle(library.id)
    const listed: unknown = (
      await state.app.inject({ method: 'GET', url: `/api/libraries/${library.id}/media` })
    ).json()
    if (!isMediaList(listed) || !listed[0]) throw new Error('nothing indexed')
    state.movie = listed[0]
    const fromTop = await state.app.inject({
      method: 'GET',
      url: `/api/media/${listed[0].id}/stream?mode=remux&start=0`,
    })
    const top = join(state.root, 'top.mp4')
    await writeFile(top, fromTop.rawPayload)
    state.lead = (await firstPacketTimes(top)).video - STREAM_TIME_SHIFT
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true })
  })

  it('lists the audio and subtitle tracks, sidecars included', async () => {
    const response = await app().inject({ method: 'GET', url: `/api/media/${movieId()}/tracks` })
    const tracks: unknown = response.json()
    if (!isMediaTracks(tracks)) throw new Error(response.body)
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

  it('serves an embedded track window as WebVTT on the file clock', async () => {
    const response = await app().inject({
      method: 'GET',
      url: `/api/media/${movieId()}/subtitles/embedded-0?window=0`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/vtt')
    // The source SRT's times, on the same clock as the server's streams.
    expect(
      parseWebVtt(response.body).map((cue) => ({
        ...cue,
        start: ms(cue.start - state.lead),
        end: ms(cue.end - state.lead),
      })),
    ).toEqual([
      { start: 1, end: 3, text: 'First <i>line</i>' },
      { start: 12.5, end: 14, text: 'Second line' },
    ])
    // The next window is past the end of a 30 second clip: empty, not an error.
    const later = await app().inject({
      method: 'GET',
      url: `/api/media/${movieId()}/subtitles/embedded-0?window=1`,
    })
    expect(later.statusCode).toBe(200)
    expect(parseWebVtt(later.body)).toEqual([])
  })

  it('converts a sidecar, falling back from UTF-8', async () => {
    const response = await app().inject({
      method: 'GET',
      url: `/api/media/${movieId()}/subtitles/external-0`,
    })
    expect(response.statusCode).toBe(200)
    expect(parseWebVtt(response.body)).toEqual([{ start: 5, end: 6, text: 'Café forced' }])
  })

  it('refuses unknown tracks and bad windows', async () => {
    const unknown = await app().inject({
      method: 'GET',
      url: `/api/media/${movieId()}/subtitles/embedded-9`,
    })
    expect(unknown.statusCode).toBe(404)
    const bad = await app().inject({
      method: 'GET',
      url: `/api/media/${movieId()}/subtitles/embedded-0?window=-1`,
    })
    expect(bad.statusCode).toBe(400)
  })

  describe('converted streams', () => {
    const fetchStream = async (query: string): Promise<string> => {
      const response = await app().inject({
        method: 'GET',
        url: `/api/media/${movieId()}/stream?${query}`,
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('video/mp4')
      expect(response.rawPayload.subarray(4, 8).toString()).toBe('ftyp')
      const path = join(state.root, `stream-${Math.random().toString(36).slice(2)}.mp4`)
      await writeFile(path, response.rawPayload)
      return path
    }

    it('starts a remux on the file clock, shifted, from the keyframe before the start', async () => {
      const times = await firstPacketTimes(await fetchStream('mode=remux&start=12&audio=1'))
      const video = times.video - STREAM_TIME_SHIFT - state.lead
      // Keyframes fall every two seconds from the video's start; ffmpeg
      // starts at one before the target.
      expect(video).toBeGreaterThanOrEqual(8)
      expect(video).toBeLessThanOrEqual(12)
      expect(Number.isInteger(ms(video))).toBe(true)
      expect(times.audio - STREAM_TIME_SHIFT).toBeGreaterThan(7.9)
    })

    it('starts at the shift itself from the top of the file', async () => {
      const times = await firstPacketTimes(await fetchStream('mode=transcode&start=0'))
      expect(times.video).toBeCloseTo(STREAM_TIME_SHIFT + state.lead, 1)
      expect(times.audio).toBeGreaterThan(0)
    })

    it('rejects a bad mode, start or audio track', async () => {
      const statuses = await Promise.all(
        ['mode=burn', 'mode=remux&start=soon', 'mode=remux&audio=7'].map(
          async (query) =>
            (await app().inject({ method: 'GET', url: `/api/media/${movieId()}/stream?${query}` }))
              .statusCode,
        ),
      )
      expect(statuses).toEqual([400, 400, 400])
    })
  })
})
