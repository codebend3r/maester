import { join } from 'node:path'
import { DEFAULT_PLAYBACK_SETTINGS } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { type MediaFile, MediaIndex } from '@/media/mediaIndex'
import { TracksService } from '@/playback/tracksService'
import { encodeClip } from '@/test/clips'
import { testDatabase } from '@/test/database'

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
  const database = testDatabase('raven-tracks-service-')
  const state = { media: '', libraryId: 0 }
  const index = () => new MediaIndex(database.get())
  const fileOf = (id: number): MediaFile => {
    const found = index().fileOf(id)
    if (!found) throw new Error(`no media ${id}`)
    return found
  }
  type AddProps = { name: string; mtimeMs: number }

  const add = ({ name, mtimeMs }: AddProps): number =>
    index().insert({
      libraryId: state.libraryId,
      kind: 'other',
      file: { path: join(state.media, name), root: state.media, size: 1, mtimeMs },
    })
  const tracksWith = (ffprobePath: string): TracksService =>
    new TracksService(
      new FfmpegService(
        { ...readServerConfig({}), ffprobePath },
        { playback: () => DEFAULT_PLAYBACK_SETTINGS },
      ),
      index(),
    )

  beforeAll(async () => {
    await database.open()
    state.media = join(database.dir(), 'media')
    await encodeClip({ path: join(state.media, 'Clip.mp4') })
    await encodeClip({ path: join(state.media, 'Other.mp4'), seconds: 2 })
    await encodeClip({ path: join(state.media, 'Third.mp4'), seconds: 2 })
    state.libraryId = new LibrariesRepository(database.get()).create({
      name: 'Test',
      paths: [state.media],
    }).id
  })

  afterAll(database.close)

  it('serves the tracks the scan stored without running ffprobe', async () => {
    const id = add({ name: 'Clip.mp4', mtimeMs: 1 })
    const stored = {
      audio: [
        { index: 0, codec: 'aac', language: 'jpn', title: 'Stored', channels: 2, default: true },
      ],
      subtitles: [],
      defaultAudio: 0,
      frameRate: 24,
    }
    index().saveProbe({ id, probe: PROBE, tracks: stored, chapters: [] })
    const resolved = await tracksWith('/nowhere/ffprobe').tracksFor(fileOf(id))
    expect(resolved.tracks.audio.map((track) => track.title)).toEqual(['Stored'])
  })

  it('probes a video the scan has not got to on its first play, and keeps what it found', async () => {
    const id = add({ name: 'Other.mp4', mtimeMs: 2 })
    const resolved = await tracksWith(readServerConfig({}).ffprobePath).tracksFor(fileOf(id))
    expect(resolved.tracks.audio).toHaveLength(1)
    expect(index().storedTracks(id)?.audio).toHaveLength(1)
  })

  it('forgets what it cached of media that is gone', async () => {
    const id = add({ name: 'Third.mp4', mtimeMs: 3 })
    const tracks = tracksWith(readServerConfig({}).ffprobePath)
    const first = tracks.tracksFor(fileOf(id))
    expect(tracks.tracksFor(fileOf(id))).toBe(first)
    tracks.forget([id])
    const again = tracks.tracksFor(fileOf(id))
    expect(again).not.toBe(first)
    await Promise.all([first, again])
  })
})
