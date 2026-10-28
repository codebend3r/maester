import { MARKER_KINDS, MARKER_SOURCES, type Marker } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { offerMarkers } from '@/markers/markerRows'
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
    index().saveProbe({ id, probe: PROBE, tracks: TRACKS, chapters: [] })
    expect(index().storedTracks(id)).toEqual(TRACKS)
    index().markChanged({ id, size: 200, mtimeMs: 2 })
    expect(index().storedTracks(id)).toBeNull()
  })

  it('keeps the chapters a probe found, with the markers their titles name, and forgets both when the file changes', () => {
    const id = add('chaptered')
    expect(index().storedChapters(id)).toBeNull()
    const chapters = [
      { start: 0, end: 90, title: 'Opening' },
      { start: 90, end: 1380, title: 'Part A' },
      { start: 1380, end: 1470, title: 'Ending' },
    ]
    index().saveProbe({ id, probe: PROBE, tracks: TRACKS, chapters })
    expect(index().storedChapters(id)).toEqual(chapters)
    expect(index().storedMarkers(id)).toEqual({
      intro: {
        kind: MARKER_KINDS.intro,
        start: 0,
        end: 90,
        source: MARKER_SOURCES.chapter,
        confidence: 1,
      },
      credits: {
        kind: MARKER_KINDS.credits,
        start: 1380,
        end: 1470,
        source: MARKER_SOURCES.chapter,
        confidence: 1,
      },
    })
    index().markChanged({ id, size: 200, mtimeMs: 2 })
    expect(index().storedChapters(id)).toBeNull()
    expect(index().storedMarkers(id)).toEqual({ intro: null, credits: null })
  })

  it('stores no chapters as an empty list, read, rather than none read', () => {
    const id = add('unchaptered')
    index().saveProbe({ id, probe: PROBE, tracks: TRACKS, chapters: [] })
    expect(index().storedChapters(id)).toEqual([])
    expect(index().storedMarkers(id)).toEqual({ intro: null, credits: null })
  })

  describe('marker precedence', () => {
    type IntroProps = { source: Marker['source']; start: number }

    const intro = ({ source, start }: IntroProps): Marker => ({
      kind: MARKER_KINDS.intro,
      start,
      end: start + 60,
      source,
      confidence: source === MARKER_SOURCES.chapter ? 1 : 0.8,
    })
    type OfferProps = { id: number; marker: Marker }

    const offer = ({ id, marker }: OfferProps) =>
      offerMarkers({ db: database.get().db, mediaId: id, markers: [marker] })
    const introStart = (id: number) => index().storedMarkers(id).intro?.start ?? null

    it('lets a stronger source replace a weaker one, and a source its own last answer', () => {
      const id = add('stronger')
      offer({ id, marker: intro({ source: MARKER_SOURCES.visual, start: 10 }) })
      offer({ id, marker: intro({ source: MARKER_SOURCES.fingerprint, start: 20 }) })
      expect(introStart(id)).toBe(20)
      offer({ id, marker: intro({ source: MARKER_SOURCES.fingerprint, start: 25 }) })
      expect(introStart(id)).toBe(25)
      offer({ id, marker: intro({ source: MARKER_SOURCES.chapter, start: 30 }) })
      expect(introStart(id)).toBe(30)
    })

    it('keeps a stronger marker over a weaker one offered later', () => {
      const id = add('weaker')
      offer({ id, marker: intro({ source: MARKER_SOURCES.chapter, start: 30 }) })
      offer({ id, marker: intro({ source: MARKER_SOURCES.fingerprint, start: 20 }) })
      expect(introStart(id)).toBe(30)
    })

    it("never replaces an admin's own, which outlives a replaced file", () => {
      const id = add('manual')
      offer({ id, marker: intro({ source: MARKER_SOURCES.manual, start: 42 }) })
      offer({ id, marker: intro({ source: MARKER_SOURCES.chapter, start: 30 }) })
      expect(introStart(id)).toBe(42)
      index().markChanged({ id, size: 300, mtimeMs: 3 })
      expect(index().storedMarkers(id).intro?.source ?? null).toBe(MARKER_SOURCES.manual)
    })
  })

  it('keeps the keyframes saved for a file, and forgets them when the file changes', () => {
    const id = add('keyframes')
    expect(index().storedKeyframes(id)).toBeNull()
    index().saveKeyframes({ id, keyframes: [0, 2.5, 4.004] })
    expect(index().storedKeyframes(id)).toEqual([0, 2.5, 4.004])
    index().markChanged({ id, size: 200, mtimeMs: 2 })
    expect(index().storedKeyframes(id)).toBeNull()
  })

  it('reads keyframes that no longer parse as none', () => {
    const id = add('garbled')
    index().saveKeyframes({ id, keyframes: [1] })
    database.get().db.prepare('UPDATE media SET keyframes = ? WHERE id = ?').run('["a"]', id)
    expect(index().storedKeyframes(id)).toBeNull()
  })

  it('counts a file probed before tracks were stored as not probed, so the scan probes it again', () => {
    index().saveProbe({ id: add('with'), probe: PROBE, tracks: TRACKS, chapters: [] })
    const before = add('before')
    index().saveProbe({ id: before, probe: PROBE, tracks: TRACKS, chapters: [] })
    database.get().db.prepare('UPDATE media SET tracks = NULL WHERE id = ?').run(before)
    add('unprobed')
    index().saveProbeError({ id: add('failed'), error: 'No audio or video streams' })
    expect(['with', 'before', 'unprobed', 'failed'].map(probed)).toEqual([true, false, false, true])
  })

  it('tells the server where a file is and what reading it needs', () => {
    const id = add('file')
    index().saveProbe({ id, probe: PROBE, tracks: TRACKS, chapters: [] })
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
