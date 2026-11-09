import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  type ApiClient,
  DEVICE_DOWNLOAD_STATES,
  type DeviceDownload,
  LIBRARY_KINDS,
  MEDIA_ORIGIN_KINDS,
  type MediaAccess,
  isRecord,
  isString,
} from '@raven/core'
import { HEADERS } from '@shared/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '@/app'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { RAVEN_CONTENT_TYPES } from '@/http'
import { DEVICE_DOWNLOAD_FAILURES, DeviceDownloadCache } from '@/media/deviceDownloadCache'
import { MediaIndex } from '@/media/mediaIndex'
import { ScannerService } from '@/scanner/scannerService'
import { NOT_WATCHING, adminCookie, testConfig } from '@/test/app'
import { encodeRichClip, encodeTrack } from '@/test/clips'
import { apiFor } from '@/test/server'

const run = promisify(execFile)

type ProbedStream = { type: string; codec: string; language: string | null; title: string | null }

type Probed = { format: string; streams: ProbedStream[] }

/** What ffprobe reads of a file: its container and each stream's kind, codec, language and title. */
const probed = async (path: string): Promise<Probed> => {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=format_name:stream=codec_type,codec_name:stream_tags=language,title,name',
    '-of',
    'json',
    path,
  ])
  const parsed: unknown = JSON.parse(stdout)
  const format =
    isRecord(parsed) && isRecord(parsed.format) && isString(parsed.format.format_name)
      ? parsed.format.format_name
      : ''
  const streams = (isRecord(parsed) && Array.isArray(parsed.streams) ? parsed.streams : [])
    .filter(isRecord)
    .map((stream): ProbedStream => {
      const tags = isRecord(stream.tags) ? stream.tags : {}
      return {
        type: String(stream.codec_type),
        codec: String(stream.codec_name),
        language: isString(tags.language) ? tags.language : null,
        // An MP4 keeps a track's title in its `name` box, which ffprobe reads as `name`.
        title: [tags.title, tags.name].find(isString) ?? null,
      }
    })
  return { format, streams }
}

const CUES = '1\n00:00:00,500 --> 00:00:02,000\nHello\n'

type EncodeFlacMkvProps = { path: string; seconds: number }

/** An MKV whose only sound is 5.1 FLAC, which AVPlayer does not play, with an English SRT track. */
const encodeFlacMkv = async ({ path, seconds }: EncodeFlacMkvProps): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  const cues = `${path}.srt`
  await writeFile(cues, CUES)
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=320x240:rate=24:duration=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-i',
    cues,
    '-map',
    '0',
    '-map',
    '1',
    '-map',
    '2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'flac',
    '-ac',
    '6',
    '-c:s',
    'srt',
    '-metadata:s:a:0',
    'language=fre',
    '-metadata:s:a:0',
    'title=Version française',
    '-metadata:s:s:0',
    'language=eng',
    path,
  ])
  await rm(cues)
}

/** A ticket on the injected app's own address, which has no origin of its own: its paths are relative. */
const ownAddress = (ticket: string): MediaAccess => ({
  origin: { kind: MEDIA_ORIGIN_KINDS.lan, url: '' },
  ticket,
})

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Three videos and a track, on a server that keeps at most one byte of device copies. */
describe('device downloads', () => {
  const state: {
    root: string
    admin: string
    flac: number
    rich: number
    spare: number
    track: number
    app: NestFastifyApplication | null
  } = { root: '', admin: '', flac: 0, rich: 0, spare: 0, track: 0, app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  const api = (): ApiClient => apiFor({ app: app(), cookie: state.admin })
  const copies = (): string => join(state.root, 'data', 'device-downloads')

  /** Asks until the copy is no longer being made, as the device polls. */
  const prepared = async (id: number): Promise<DeviceDownload> => {
    const answer = await api().getDeviceDownload(id)
    if (answer.state !== DEVICE_DOWNLOAD_STATES.preparing) return answer
    expect(answer.progress).toBeGreaterThanOrEqual(0)
    expect(answer.progress).toBeLessThan(1)
    await pause(50)
    return prepared(id)
  }

  const fileUrl = async (id: number): Promise<string> => {
    const { ticket } = await api().getMediaTicket(id)
    return apiFor({ app: app() }).deviceDownloadFileUrl({ id, access: ownAddress(ticket) })
  }

  const download = async (id: number): Promise<Buffer> => {
    const response = await app().inject({ method: 'GET', url: await fileUrl(id) })
    expect(response.statusCode).toBe(200)
    return response.rawPayload
  }

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-device-downloads-'))
    await encodeFlacMkv({ path: join(state.root, 'films', 'Amélie (2001).mkv'), seconds: 3 })
    await encodeRichClip({
      path: join(state.root, 'films', 'Heat (1995).mkv'),
      seconds: 3,
      cues: CUES,
    })
    await encodeRichClip({
      path: join(state.root, 'films', 'Ran (1985).mkv'),
      seconds: 2,
      cues: CUES,
    })
    await encodeTrack({
      path: join(state.root, 'music', 'Blur', 'Blur', '01 Beetlebum.flac'),
      seconds: 2,
      tags: { title: 'Beetlebum', artist: 'Blur', album: 'Blur', track: '1' },
    })
    const base = testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root })
    state.app = await createApp({
      config: {
        ...base,
        mediaPlane: { ...base.mediaPlane, secret: randomBytes(32) },
        deviceDownloadCacheBytes: 1,
      },
      quiet: true,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    state.admin = await adminCookie(state.app)
    const films = await api().createLibrary({ name: 'Films', paths: [join(state.root, 'films')] })
    const music = await api().createLibrary({
      name: 'Music',
      paths: [join(state.root, 'music')],
      settings: { kind: LIBRARY_KINDS.music },
    })
    await app().get(ScannerService).whenIdle(films.id)
    await app().get(ScannerService).whenIdle(music.id)
    const index = app().get(MediaIndex)
    const idNamed = (name: string): number =>
      index.idsForLibrary(films.id).find((id) => index.fileOf(id)?.fileName === name) ?? 0
    state.flac = idNamed('Amélie (2001).mkv')
    state.rich = idNamed('Heat (1995).mkv')
    state.spare = idNamed('Ran (1985).mkv')
    state.track = index.idsForLibrary(music.id)[0] ?? 0
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('answers 409 for the copy before it is made', async () => {
    const response = await app().inject({ method: 'GET', url: await fileUrl(state.spare) })
    expect(response.statusCode).toBe(409)
  })

  it('makes an MP4 of an MKV, converting FLAC to E-AC-3 and SRT to mov_text, and keeps the tags', async () => {
    const first = await api().getDeviceDownload(state.flac)
    expect(first).toEqual({ state: DEVICE_DOWNLOAD_STATES.preparing, progress: expect.any(Number) })
    const ready = await prepared(state.flac)
    expect(ready).toEqual({ state: DEVICE_DOWNLOAD_STATES.ready, bytes: expect.any(Number) })

    const body = await download(state.flac)
    expect(body.length).toBe(ready.state === DEVICE_DOWNLOAD_STATES.ready ? ready.bytes : -1)
    const saved = join(state.root, 'flac.mp4')
    await writeFile(saved, body)
    const { format, streams } = await probed(saved)
    expect(format).toContain('mp4')
    expect(streams).toEqual([
      expect.objectContaining({ type: 'video', codec: 'h264' }),
      { type: 'audio', codec: 'eac3', language: 'fre', title: 'Version française' },
      expect.objectContaining({ type: 'subtitle', codec: 'mov_text', language: 'eng' }),
    ])
  })

  it('copies AC-3 and AAC as they are, and serves the copy with byte ranges, by ticket', async () => {
    const ready = await prepared(state.rich)
    expect(ready.state).toBe(DEVICE_DOWNLOAD_STATES.ready)
    const url = await fileUrl(state.rich)
    const whole = await app().inject({ method: 'GET', url })
    expect(whole.statusCode).toBe(200)
    expect(whole.headers[HEADERS.contentType]).toBe(RAVEN_CONTENT_TYPES.mp4)
    expect(Number(whole.headers[HEADERS.contentLength])).toBe(whole.rawPayload.length)
    const part = await app().inject({
      method: 'GET',
      url,
      headers: { [HEADERS.range]: 'bytes=0-99' },
    })
    expect(part.statusCode).toBe(206)
    expect(part.headers[HEADERS.contentRange]).toBe(`bytes 0-99/${whole.rawPayload.length}`)
    expect(part.rawPayload).toEqual(whole.rawPayload.subarray(0, 100))

    const saved = join(state.root, 'rich.mp4')
    await writeFile(saved, whole.rawPayload)
    const { streams } = await probed(saved)
    expect(streams.filter(({ type }) => type === 'audio')).toEqual([
      expect.objectContaining({ codec: 'ac3', language: 'eng' }),
      expect.objectContaining({ codec: 'aac', language: 'jpn', title: 'Commentary' }),
    ])
  })

  it('says a failed copy once, plainly, then tries again on the next ask', async () => {
    await rm(join(copies(), String(state.spare)), { recursive: true, force: true })
    const probe = vi
      .spyOn(app().get(FfmpegService), 'probeFile')
      .mockRejectedValueOnce(new Error('/secret/path/Ran (1985).mkv: Invalid data'))
    try {
      expect(await prepared(state.spare)).toEqual({
        state: DEVICE_DOWNLOAD_STATES.failed,
        message: DEVICE_DOWNLOAD_FAILURES.failed,
      })
    } finally {
      probe.mockRestore()
    }
    expect((await prepared(state.spare)).state).toBe(DEVICE_DOWNLOAD_STATES.ready)
  })

  it('runs one remux for asks that overlap', async () => {
    await rm(join(copies(), String(state.spare)), { recursive: true, force: true })
    const remux = vi.spyOn(app().get(FfmpegService), 'convert')
    try {
      await Promise.all([
        api().getDeviceDownload(state.spare),
        api().getDeviceDownload(state.spare),
      ])
      expect((await prepared(state.spare)).state).toBe(DEVICE_DOWNLOAD_STATES.ready)
      expect(remux).toHaveBeenCalledTimes(1)
    } finally {
      remux.mockRestore()
    }
  })

  it('evicts to the cap, keeping the most recently served copy and any being sent', async () => {
    // Each new copy sweeps first, so the one held is the one a later copy would take.
    await prepared(state.rich)
    await pause(20)
    await prepared(state.flac)
    const cache = app().get(DeviceDownloadCache)
    const held = await cache.open({
      mediaId: state.flac,
      mtimeMs: app().get(MediaIndex).fileOf(state.flac)?.mtimeMs ?? 0,
    })
    expect(held).not.toBeNull()
    await pause(20)
    await prepared(state.spare)
    const orphan = join(copies(), '987654')
    await mkdir(orphan, { recursive: true })
    await writeFile(join(orphan, '1.mp4'), 'gone')

    await cache.sweep()
    expect((await readdir(copies())).toSorted()).toEqual(
      [String(state.flac), String(state.rich), String(state.spare)].toSorted(),
    )
    expect(await readdir(join(copies(), String(state.rich)))).toEqual([])
    expect(await readdir(join(copies(), String(state.flac)))).toHaveLength(1)
    expect(await readdir(join(copies(), String(state.spare)))).toHaveLength(1)

    held?.release()
    await cache.sweep()
    expect(await readdir(join(copies(), String(state.flac)))).toEqual([])
  })

  it('answers 409 for a track', async () => {
    await expect(api().getDeviceDownload(state.track)).rejects.toMatchObject({ status: 409 })
  })
})
