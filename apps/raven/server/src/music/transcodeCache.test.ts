import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  AUDIO_BITRATES,
  type ApiClient,
  type AudioBitrate,
  LIBRARY_KINDS,
  isRecord,
} from '@raven/core'
import { HEADERS } from '@shared/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '@/app'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { RAVEN_CONTENT_TYPES } from '@/http'
import { type MediaFile, MediaIndex } from '@/media/mediaIndex'
import { TranscodeCache, transcodeTimeoutSeconds } from '@/music/transcodeCache'
import { ScannerService } from '@/scanner/scannerService'
import { NOT_WATCHING, adminCookie, testConfig } from '@/test/app'
import { encodeClip, encodeTrack } from '@/test/clips'
import { apiFor } from '@/test/server'

const run = promisify(execFile)

const { low, standard, high } = AUDIO_BITRATES

/** What ffprobe reads of a file's first audio stream: its codec and its bitrate in bits a second. */
const probed = async (path: string): Promise<{ codec: string; bitRate: number }> => {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name,bit_rate',
    '-of',
    'json',
    path,
  ])
  const parsed: unknown = JSON.parse(stdout)
  const [stream] = isRecord(parsed) && Array.isArray(parsed.streams) ? parsed.streams : []
  return isRecord(stream)
    ? { codec: String(stream.codec_name), bitRate: Number(stream.bit_rate) }
    : { codec: '', bitRate: 0 }
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** A FLAC track and a video, on a server that keeps at most one byte of transcodes. */
describe('the transcode cache', () => {
  const state: {
    root: string
    admin: string
    track: number
    video: number
    app: NestFastifyApplication | null
  } = { root: '', admin: '', track: 0, video: 0, app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const api = (): ApiClient => apiFor({ app: app(), cookie: state.admin })
  const cache = (): TranscodeCache => app().get(TranscodeCache)
  const track = (): MediaFile => {
    const file = app().get(MediaIndex).fileOf(state.track)
    if (!file) throw new Error('the track was not scanned')
    return file
  }
  const transcodes = (): string => join(state.root, 'data', 'transcodes')

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-transcodes-'))
    await encodeTrack({
      path: join(state.root, 'music', 'Blur', 'Blur', '01 Beetlebum.flac'),
      seconds: 3,
      isNoise: true,
      tags: { title: 'Beetlebum', artist: 'Blur', album: 'Blur', track: '1' },
    })
    await encodeClip({ path: join(state.root, 'films', 'Heat (1995).mp4'), seconds: 1 })
    const base = testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root })
    state.app = await createApp({
      config: {
        ...base,
        mediaPlane: { ...base.mediaPlane, secret: randomBytes(32) },
        transcodeCacheBytes: 1,
      },
      quiet: true,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    state.admin = await adminCookie(state.app)
    const music = await api().createLibrary({
      name: 'Music',
      paths: [join(state.root, 'music')],
      settings: { kind: LIBRARY_KINDS.music },
    })
    const films = await api().createLibrary({ name: 'Films', paths: [join(state.root, 'films')] })
    await app().get(ScannerService).whenIdle(music.id)
    await app().get(ScannerService).whenIdle(films.id)
    state.track = app().get(MediaIndex).idsForLibrary(music.id)[0] ?? 0
    state.video = app().get(MediaIndex).idsForLibrary(films.id)[0] ?? 0
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  type AskProps = { kbps: AudioBitrate; mtimeMs?: number; durationSeconds?: number | null }

  /** The track at `kbps`, as the index has it unless the ask says otherwise. */
  const ask = ({
    kbps,
    mtimeMs = track().mtimeMs,
    durationSeconds = track().duration,
  }: AskProps): Promise<string> =>
    cache().fileFor({ mediaId: state.track, path: track().path, mtimeMs, durationSeconds, kbps })

  beforeEach(async () => {
    await rm(join(transcodes(), String(state.track)), { recursive: true, force: true })
  })

  it('makes `<mtimeMs>-<kbps>.m4a` in the track’s folder, AAC at about the bitrate asked', async () => {
    const made = await ask({ kbps: standard })
    expect(dirname(made)).toBe(join(transcodes(), String(state.track)))
    expect(basename(made)).toBe(`${Math.round(track().mtimeMs)}-${standard}.m4a`)
    const { codec, bitRate } = await probed(made)
    expect(codec).toBe('aac')
    expect(bitRate).toBeGreaterThan(standard * 1000 * 0.75)
    expect(bitRate).toBeLessThan(standard * 1000 * 1.1)
  })

  it('runs ffmpeg once for two asks at once', async () => {
    const exec = vi.spyOn(app().get(FfmpegService), 'exec')
    try {
      const [first, second] = await Promise.all([ask({ kbps: low }), ask({ kbps: low })])
      expect(first).toBe(second)
      expect(exec).toHaveBeenCalledTimes(1)
    } finally {
      exec.mockRestore()
    }
  })

  it('gives a long track, or one of unknown length, longer than ffmpeg’s usual limit', async () => {
    const baseSeconds = app().get<ServerConfig>(SERVER_CONFIG).ffmpegTimeoutSeconds
    expect(transcodeTimeoutSeconds({ durationSeconds: 180, baseSeconds })).toBe(baseSeconds)
    expect(transcodeTimeoutSeconds({ durationSeconds: 3 * 60 * 60, baseSeconds })).toBe(2700)
    expect(transcodeTimeoutSeconds({ durationSeconds: null, baseSeconds })).toBe(4 * 60 * 60)
    const exec = vi.spyOn(app().get(FfmpegService), 'exec')
    try {
      await ask({ kbps: low, durationSeconds: 60 * 60 })
      expect(exec).toHaveBeenCalledWith(expect.objectContaining({ timeoutSeconds: 900 }))
    } finally {
      exec.mockRestore()
    }
  })

  it('makes a new file once the track changes, and removes what it made of the old one', async () => {
    const { mtimeMs } = track()
    const older = await ask({ kbps: high, mtimeMs })
    await ask({ kbps: low, mtimeMs })
    const newer = await ask({ kbps: high, mtimeMs: mtimeMs + 1000 })
    expect(newer).not.toBe(older)
    expect(await readdir(dirname(newer))).toEqual([basename(newer)])
  })

  it('evicts to the cap, keeping the most recently served file, and removes orphans', async () => {
    const served = await ask({ kbps: low })
    await pause(20)
    await ask({ kbps: standard })
    await pause(20)
    await ask({ kbps: low })
    const orphan = join(transcodes(), '987654')
    await mkdir(orphan, { recursive: true })
    await writeFile(join(orphan, `1-${standard}.m4a`), 'gone')

    await cache().sweep()

    expect(await readdir(transcodes())).toEqual([String(state.track)])
    expect(await readdir(dirname(served))).toEqual([basename(served)])
  })

  it('serves the transcode with byte ranges, by ticket', async () => {
    const { ticket } = await api().getMediaTicket(state.track)
    const url = apiFor({ app: app() }).transcodeUrl({
      mediaId: state.track,
      kbps: standard,
      ticket,
    })
    const whole = await app().inject({ method: 'GET', url })
    expect(whole.statusCode).toBe(200)
    expect(whole.headers[HEADERS.contentType]).toBe(RAVEN_CONTENT_TYPES.audioMp4)
    expect(Number(whole.headers[HEADERS.contentLength])).toBe(whole.rawPayload.length)

    const part = await app().inject({
      method: 'GET',
      url,
      headers: { [HEADERS.range]: 'bytes=0-99' },
    })
    expect(part.statusCode).toBe(206)
    expect(part.headers[HEADERS.contentRange]).toBe(`bytes 0-99/${whole.rawPayload.length}`)
    expect(part.rawPayload).toEqual(whole.rawPayload.subarray(0, 100))
  })

  it('answers 400 for a bitrate it does not offer, and 409 for a video', async () => {
    type AtProps = { query: string; id: number }

    const at = ({ query, id }: AtProps) =>
      app().inject({
        method: 'GET',
        url: `/api/media/${id}/transcode${query}`,
        headers: { cookie: state.admin },
      })
    expect((await at({ query: '?kbps=192', id: state.track })).statusCode).toBe(400)
    expect((await at({ query: '', id: state.track })).statusCode).toBe(400)
    expect((await at({ query: `?kbps=${standard}`, id: state.video })).statusCode).toBe(409)
  })

  it('converts the file on disk again once it changes, before any rescan', async () => {
    const { path } = track()
    const { ticket } = await api().getMediaTicket(state.track)
    const url = apiFor({ app: app() }).transcodeUrl({
      mediaId: state.track,
      kbps: standard,
      ticket,
    })
    const before = await app().inject({ method: 'GET', url })
    await encodeTrack({ path, seconds: 6, isNoise: true, tags: { title: 'Beetlebum' } })
    const changedAt = new Date(Date.now() + 60_000)
    await utimes(path, changedAt, changedAt)

    const after = await app().inject({ method: 'GET', url })

    expect(after.statusCode).toBe(200)
    expect(after.rawPayload.length).toBeGreaterThan(before.rawPayload.length)
    expect(await readdir(join(transcodes(), String(state.track)))).toEqual([
      `${Math.round((await stat(path)).mtimeMs)}-${standard}.m4a`,
    ])
  })
})
