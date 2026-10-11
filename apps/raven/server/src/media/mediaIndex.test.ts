import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import { testDatabase } from '@/test/database'

const TRACKS = {
  audio: [{ index: 0, codec: 'aac', language: 'eng', title: null, channels: 2, default: true }],
  subtitles: [],
  defaultAudio: 0,
  frameRate: 24,
}

const PROBE = {
  duration: 60,
  width: 1920,
  height: 1080,
  videoCodec: 'h264',
  videoBitDepth: 8,
  hdr: true,
  audioCodec: 'aac',
  audioChannels: 2,
  bitrate: 5_000_000,
}

describe('the media index', () => {
  const database = testDatabase('raven-index-')
  const state = { libraryId: 0 }
  const index = () => new MediaIndex(database.get())
  const add = (name: string): number =>
    index().insert({
      libraryId: state.libraryId,
      kind: 'other',
      file: { path: `/m/${name}.mp4`, root: '/m', size: 100, mtimeMs: 1 },
    })
  const probed = (name: string): boolean | undefined =>
    index().forLibrary(state.libraryId).get(`/m/${name}.mp4`)?.probed

  beforeAll(async () => {
    await database.open()
    state.libraryId = new LibrariesRepository(database.get()).create({
      name: 'Test',
      paths: ['/m'],
    }).id
  })

  afterAll(database.close)

  it('keeps the tracks a probe found, and forgets them when the file changes', () => {
    const id = add('kept')
    index().saveProbe({ id, probe: PROBE, tracks: TRACKS })
    expect(index().storedTracks(id)).toEqual(TRACKS)
    index().markChanged({ id, size: 200, mtimeMs: 2 })
    expect(index().storedTracks(id)).toBeNull()
  })

  it('counts a file probed before tracks were stored as not probed, so the scan probes it again', () => {
    index().saveProbe({ id: add('with'), probe: PROBE, tracks: TRACKS })
    const before = add('before')
    index().saveProbe({ id: before, probe: PROBE, tracks: TRACKS })
    database.get().db.prepare('UPDATE media SET tracks = NULL WHERE id = ?').run(before)
    add('unprobed')
    index().saveProbeError({ id: add('failed'), error: 'No audio or video streams' })
    expect(['with', 'before', 'unprobed', 'failed'].map(probed)).toEqual([true, false, false, true])
  })

  it('tells the server where a file is and what reading it needs', () => {
    const id = add('file')
    index().saveProbe({ id, probe: PROBE, tracks: TRACKS })
    expect(index().fileOf(id)).toEqual({
      id,
      libraryId: state.libraryId,
      path: '/m/file.mp4',
      fileName: 'file.mp4',
      container: 'mp4',
      mtimeMs: 1,
      duration: 60,
      videoCodec: 'h264',
      hdr: true,
      thumbnail: 'pending',
    })
    expect(index().libraryOf(id)).toBe(state.libraryId)
    index().remove([id])
    expect(index().fileOf(id)).toBeNull()
    expect(index().libraryOf(id)).toBeNull()
  })
})
