import { mkdtemp, rm, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { LIBRARY_KINDS } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '@/app'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { DatabaseService } from '@/db/database'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { MediaIndex } from '@/media/mediaIndex'
import { LOUDNESS_STATES, LOUDNESS_VERSION, REPLAYGAIN_SOURCES } from '@/music/loudness'
import { LoudnessJobs } from '@/music/loudnessJobs'
import { LoudnessScan } from '@/music/loudnessScan'
import { ScannerService } from '@/scanner/scannerService'
import { NOT_WATCHING, adminCookie, testConfig } from '@/test/app'
import { encodeTrack } from '@/test/clips'
import { apiFor } from '@/test/server'

const ALBUM = { title: 'Parklife', artist: 'Blur', album: 'Parklife' } as const

/** The files, by name: two tagless tracks of one album, one tagged with its gains, and one emptied after it was read. */
const FILES = {
  quiet: '01 Quiet.flac',
  loud: '02 Loud.flac',
  tagged: '01 Tagged.flac',
  broken: '01 Broken.flac',
} as const

type TrackRow = {
  replaygain_gain: number | null
  replaygain_peak: number | null
  replaygain_source: string | null
  loudness_state: string
  loudness_version: number
}

type AlbumRow = {
  replaygain_gain: number | null
  replaygain_peak: number | null
  replaygain_source: string | null
}

describe('the loudness scan', () => {
  const state: { root: string; app: NestFastifyApplication | null; ids: Map<string, number> } = {
    root: '',
    app: null,
    ids: new Map(),
  }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }
  /** A scan over the app's own stores that is switched on, as the app's own is not under test. */
  const scan = (): LoudnessScan =>
    new LoudnessScan(
      { ...app().get<ServerConfig>(SERVER_CONFIG), loudnessScan: true },
      app().get(LoudnessJobs),
      app().get(FfmpegService),
    )
  const trackOf = (name: string): TrackRow | undefined =>
    app()
      .get(DatabaseService)
      .db.prepare<[number], TrackRow>(
        `SELECT replaygain_gain, replaygain_peak, replaygain_source, loudness_state, loudness_version
           FROM tracks WHERE media_id = ?`,
      )
      .get(state.ids.get(name) ?? -1)
  const albumOf = (name: string): AlbumRow | undefined =>
    app()
      .get(DatabaseService)
      .db.prepare<[number], AlbumRow>(
        `SELECT a.replaygain_gain, a.replaygain_peak, a.replaygain_source
           FROM albums a JOIN tracks t ON t.album_id = a.id WHERE t.media_id = ?`,
      )
      .get(state.ids.get(name) ?? -1)

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-loudness-'))
    const music = join(state.root, 'music')
    await encodeTrack({
      path: join(music, 'Blur', 'Parklife', FILES.quiet),
      seconds: 2,
      tags: { ...ALBUM, title: 'Quiet', track: '1' },
    })
    await encodeTrack({
      path: join(music, 'Blur', 'Parklife', FILES.loud),
      seconds: 2,
      isNoise: true,
      tags: { ...ALBUM, title: 'Loud', track: '2' },
    })
    await encodeTrack({
      path: join(music, 'Blur', 'Tagged', FILES.tagged),
      tags: {
        title: 'Tagged',
        artist: 'Blur',
        album: 'Tagged',
        REPLAYGAIN_TRACK_GAIN: '-6.00 dB',
        REPLAYGAIN_TRACK_PEAK: '0.500000',
        REPLAYGAIN_ALBUM_GAIN: '-7.00 dB',
        REPLAYGAIN_ALBUM_PEAK: '0.600000',
      },
    })
    await encodeTrack({
      path: join(music, 'Blur', 'Broken', FILES.broken),
      tags: { title: 'Broken', artist: 'Blur', album: 'Broken' },
    })
    state.app = await createApp({
      config: testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
      quiet: true,
      watch: NOT_WATCHING,
    })
    await state.app.init()
    const library = await apiFor({ app: app(), cookie: await adminCookie(app()) }).createLibrary({
      name: 'Music',
      paths: [music],
      settings: { kind: LIBRARY_KINDS.music },
    })
    await app().get(ScannerService).whenIdle(library.id)
    app()
      .get(MediaIndex)
      .idsForLibrary(library.id)
      .forEach((id) => {
        const path = app().get(MediaIndex).fileOf(id)?.path ?? ''
        state.ids.set(path.split('/').at(-1) ?? '', id)
      })
    await truncate(join(music, 'Blur', 'Broken', FILES.broken), 0)
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('leaves every track waiting while LOUDNESS_SCAN is off', async () => {
    await app().get(LoudnessScan).whenIdle()
    expect(trackOf(FILES.quiet)).toMatchObject({
      replaygain_gain: null,
      loudness_state: LOUDNESS_STATES.pending,
    })
  })

  it('measures the tagless tracks and gives their album a gain from both', async () => {
    const scanner = scan()
    scanner.kick()
    await scanner.whenIdle()
    const quiet = trackOf(FILES.quiet)
    const loud = trackOf(FILES.loud)
    expect(quiet).toMatchObject({
      replaygain_source: REPLAYGAIN_SOURCES.scan,
      loudness_state: LOUDNESS_STATES.done,
      loudness_version: LOUDNESS_VERSION,
    })
    expect(loud).toMatchObject({ replaygain_source: REPLAYGAIN_SOURCES.scan })
    const quietGain = quiet?.replaygain_gain ?? Number.NaN
    const loudGain = loud?.replaygain_gain ?? Number.NaN
    expect(loudGain).toBeLessThan(quietGain)
    expect(quiet?.replaygain_peak).toBeGreaterThan(0)
    const album = albumOf(FILES.quiet)
    expect(album?.replaygain_source).toBe(REPLAYGAIN_SOURCES.scan)
    expect(album?.replaygain_gain).toBeLessThan(quietGain)
    expect(album?.replaygain_gain).toBeGreaterThan(loudGain)
    expect(album?.replaygain_peak).toBe(
      Math.max(quiet?.replaygain_peak ?? 0, loud?.replaygain_peak ?? 0),
    )
  })

  it('leaves a track and an album whose tags carry their gains as the tags say', () => {
    expect(trackOf(FILES.tagged)).toEqual({
      replaygain_gain: -6,
      replaygain_peak: 0.5,
      replaygain_source: REPLAYGAIN_SOURCES.tags,
      loudness_state: LOUDNESS_STATES.pending,
      loudness_version: 0,
    })
    expect(albumOf(FILES.tagged)).toEqual({
      replaygain_gain: -7,
      replaygain_peak: 0.6,
      replaygain_source: REPLAYGAIN_SOURCES.tags,
    })
  })

  it('fails a file ffmpeg cannot read, and does not try it again', async () => {
    expect(trackOf(FILES.broken)).toMatchObject({
      replaygain_gain: null,
      loudness_state: LOUDNESS_STATES.failed,
      loudness_version: LOUDNESS_VERSION,
    })
    expect(albumOf(FILES.broken)?.replaygain_gain).toBeNull()
    const analyse = vi.spyOn(app().get(FfmpegService), 'analyseErr')
    const again = scan()
    again.kick()
    await again.whenIdle()
    expect(analyse).not.toHaveBeenCalled()
    analyse.mockRestore()
  })
})
