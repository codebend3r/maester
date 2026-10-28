import { join } from 'node:path'
import { DEFAULT_PLAYBACK_SETTINGS, MARKER_KINDS, MARKER_SOURCES } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MarkersService } from '@/markers/markersService'
import { type MediaFile, MediaIndex } from '@/media/mediaIndex'
import { addChapters, encodeClip } from '@/test/clips'
import { testDatabase } from '@/test/database'

describe('MarkersService', () => {
  const database = testDatabase('raven-markers-service-')
  const state = { media: '', libraryId: 0 }
  const index = () => new MediaIndex(database.get())
  const fileOf = (id: number): MediaFile => {
    const found = index().fileOf(id)
    if (!found) throw new Error(`no media ${id}`)
    return found
  }
  const add = (name: string): number =>
    index().insert({
      libraryId: state.libraryId,
      kind: 'other',
      file: { path: join(state.media, name), root: state.media, size: 1, mtimeMs: 1 },
    })
  const markersWith = (ffprobePath: string): MarkersService =>
    new MarkersService(
      new FfmpegService(
        { ...readServerConfig({}), ffprobePath },
        { playback: () => DEFAULT_PLAYBACK_SETTINGS },
      ),
      index(),
    )

  beforeAll(async () => {
    await database.open()
    state.media = join(database.dir(), 'media')
    const episode = join(state.media, 'Episode.mkv')
    await encodeClip({ path: episode, seconds: 6 })
    await addChapters({
      path: episode,
      chapters: [
        { start: 0, end: 2, title: 'Opening' },
        { start: 2, end: 5, title: 'Part A' },
        { start: 5, end: 6, title: 'Ending' },
      ],
    })
    await encodeClip({ path: join(state.media, 'Film.mp4'), seconds: 2 })
    state.libraryId = new LibrariesRepository(database.get()).create({
      name: 'Test',
      paths: [state.media],
    }).id
  })

  afterAll(database.close)

  it("reads a file's chapters on its first ask, and the intro and credits their titles name", async () => {
    const id = add('Episode.mkv')
    const markers = await markersWith('ffprobe').markersFor(fileOf(id))
    expect(markers.chapters.map(({ title }) => title)).toEqual(['Opening', 'Part A', 'Ending'])
    expect(markers.intro).toMatchObject({
      kind: MARKER_KINDS.intro,
      source: MARKER_SOURCES.chapter,
      confidence: 1,
    })
    expect(markers.intro?.end ?? Number.NaN).toBeCloseTo(2)
    expect(markers.credits?.start ?? Number.NaN).toBeCloseTo(5)
    // Kept: a second ask runs no ffprobe, so one that cannot run changes nothing.
    expect(await markersWith('/nowhere/ffprobe').markersFor(fileOf(id))).toEqual(markers)
  })

  it('answers no intro or credits for a file without chapters', async () => {
    const id = add('Film.mp4')
    expect(await markersWith('ffprobe').markersFor(fileOf(id))).toEqual({
      intro: null,
      credits: null,
      chapters: [],
    })
  })
})
