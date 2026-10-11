import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import { DatabaseService } from '@/db/database'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { type MediaRecord, MediaRepository } from '@/media/mediaRepository'
import { TracksService } from '@/playback/tracksService'
import { encodeClip } from '@/test/clips'

const PROBE = {
  duration: 6,
  width: 320,
  height: 240,
  videoCodec: 'h264',
  videoBitDepth: 8,
  hdr: false,
  audioCodec: 'aac',
  audioChannels: 2,
  bitrate: 500_000,
}

describe('TracksService', () => {
  const state = {
    dir: '',
    clip: '',
    other: '',
    libraryId: 0,
    database: null as DatabaseService | null,
    media: null as MediaRepository | null,
  }
  const media = (): MediaRepository => {
    if (!state.media) throw new Error('not set up')
    return state.media
  }
  const record = (id: number): MediaRecord => {
    const found = media().get(id)
    if (!found) throw new Error(`no media ${id}`)
    return found
  }
  const tracksWith = (ffprobePath: string): TracksService =>
    new TracksService(
      new FfmpegService({ ...readServerConfig({}), dataDir: state.dir, ffprobePath }),
      media(),
    )

  beforeAll(async () => {
    state.dir = await mkdtemp(join(tmpdir(), 'raven-tracks-service-'))
    state.clip = join(state.dir, 'media', 'Clip.mp4')
    state.other = join(state.dir, 'media', 'Other.mp4')
    await encodeClip({ path: state.clip })
    await encodeClip({ path: state.other, seconds: 2 })
    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    state.database = database
    state.media = new MediaRepository(database)
    state.libraryId = new LibrariesRepository(database).create({
      name: 'Test',
      paths: [join(state.dir, 'media')],
    }).id
  })

  afterAll(async () => {
    state.database?.onModuleDestroy()
    await rm(state.dir, { recursive: true, force: true })
  })

  it('serves the tracks the scan stored without running ffprobe', async () => {
    const id = media().insert({
      libraryId: state.libraryId,
      file: { path: state.clip, root: join(state.dir, 'media'), size: 1, mtimeMs: 1 },
    })
    const stored = {
      audio: [
        { index: 0, codec: 'aac', language: 'jpn', title: 'Stored', channels: 2, default: true },
      ],
      subtitles: [],
      defaultAudio: 0,
      frameRate: 24,
    }
    media().saveProbe({ id, probe: PROBE, tracks: stored })
    const resolved = await tracksWith('/nowhere/ffprobe').tracksFor(record(id))
    expect(resolved.tracks.audio.map((track) => track.title)).toEqual(['Stored'])
  })

  it('probes a video that has no stored tracks once, and keeps what it found', async () => {
    const id = media().insert({
      libraryId: state.libraryId,
      file: { path: state.other, root: join(state.dir, 'media'), size: 2, mtimeMs: 2 },
    })
    media().saveProbe({ id, probe: PROBE })
    const resolved = await tracksWith(readServerConfig({}).ffprobePath).tracksFor(record(id))
    expect(resolved.tracks.audio).toHaveLength(1)
    expect(media().storedTracks(id)?.audio).toHaveLength(1)
  })
})
