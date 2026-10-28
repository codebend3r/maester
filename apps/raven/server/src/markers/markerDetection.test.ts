import {
  DEFAULT_PLAYBACK_SETTINGS,
  ITEM_TYPES,
  type ItemType,
  LIBRARY_KINDS,
  MARKER_SOURCES,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readServerConfig } from '@/config'
import type { FfmpegService } from '@/ffmpeg/ffmpegService'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { RUN_LEAD_S } from '@/markers/seasonIntros'
import { MARKER_DETECTOR_VERSION, MarkerJobs } from '@/markers/markerJobs'
import { MarkerDetection, YIELD_MS } from '@/markers/markerDetection'
import { MARKER_STATES } from '@/markers/markerRows'
import { noise, pointsFor, withTheme } from '@/test/fingerprints'
import { MediaIndex } from '@/media/mediaIndex'
import { BLANK_ITEM, type FetchedItem } from '@/metadata/tmdbShapes'
import { testDatabase } from '@/test/database'
import { repositories } from '@/test/repositories'

const PROBE = {
  duration: 2400,
  width: 1920,
  height: 1080,
  videoCodec: 'h264',
  videoBitDepth: 8,
  hdr: false,
  audioCodec: 'aac',
  audioChannels: 2,
  bitrate: 5_000_000,
}

const TRACKS = { audio: [], subtitles: [], defaultAudio: null, frameRate: 24 }

const THEME = noise({ seed: 4242, count: pointsFor(45) })

/** Where each made up episode's intro starts, by file name; null for one with none. */
const INTRO_AT = new Map<string, number | null>([
  ['Show - S01E01.mkv', 50],
  ['Show - S01E02.mkv', 120],
  ['Show - S01E03.mkv', 75],
  ['Show - S01E03 (720p).mkv', 75],
  ['Show - S02E01.mkv', null],
])

type FetchedProps = { type: ItemType; tmdbId: string; number?: number | null }

const fetched = ({ type, tmdbId, number = null }: FetchedProps): FetchedItem => ({
  ...BLANK_ITEM,
  type,
  tmdbId,
  number,
  title: tmdbId,
})

/** ffmpeg as detection uses it: each file's fingerprint made up from `INTRO_AT`, and whether a viewer's conversion runs. */
const fakeFfmpeg = () => {
  const state = { isConverting: false }
  const fingerprint = vi.fn<FfmpegService['fingerprint']>(async ({ path, seconds }) => {
    const name = path.split('/').at(-1) ?? ''
    const at = INTRO_AT.get(name) ?? null
    const seed = Array.from(name).reduce(
      (hash, char) => (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0,
      3,
    )
    return at === null
      ? noise({ seed, count: pointsFor(seconds) })
      : withTheme({ seed, seconds, theme: THEME, at })
  })
  const ffmpeg: Pick<FfmpegService, 'fingerprint' | 'isConverting'> = {
    fingerprint,
    isConverting: () => state.isConverting,
  }
  return { ffmpeg, fingerprint, state }
}

describe('MarkerDetection', () => {
  const database = testDatabase('raven-marker-detection-')
  const ids = new Map<string, number>()
  const index = () => new MediaIndex(database.get())
  const jobs = () => new MarkerJobs(database.get())
  type DetectionWithProps = {
    ffmpeg: Pick<FfmpegService, 'fingerprint' | 'isConverting'>
    detectMarkers?: boolean
  }

  const detectionWith = ({ ffmpeg, detectMarkers = true }: DetectionWithProps) =>
    new MarkerDetection(readServerConfig({}), jobs(), ffmpeg, {
      playback: () => ({ ...DEFAULT_PLAYBACK_SETTINGS, detectMarkers }),
    })
  const stateOf = (name: string) =>
    database
      .get()
      .db.prepare<[number], { markers: string; markers_version: number }>(
        'SELECT markers, markers_version FROM media WHERE id = ?',
      )
      .get(ids.get(name) ?? -1)

  beforeAll(async () => {
    await database.open()
    const { metadata } = repositories(database.get())
    const libraryId = new LibrariesRepository(database.get()).create({
      name: 'TV',
      paths: ['/tv'],
      settings: { kind: LIBRARY_KINDS.shows },
    }).id
    const showId = metadata.save({ item: fetched({ type: ITEM_TYPES.show, tmdbId: 'Show' }) })
    Array.from(INTRO_AT.keys()).forEach((name) => {
      const [, season = 0, episode = 0] = /S(\d+)E(\d+)/u.exec(name)?.map(Number) ?? []
      const seasonId = metadata.save({
        item: fetched({ type: ITEM_TYPES.season, tmdbId: `Show-${season}`, number: season }),
        parentId: showId,
      })
      const episodeId = metadata.save({
        item: fetched({
          type: ITEM_TYPES.episode,
          tmdbId: `Show-${season}-${episode}`,
          number: episode,
        }),
        parentId: seasonId,
      })
      const id = index().insert({
        libraryId,
        kind: LIBRARY_KINDS.shows,
        file: { path: `/tv/${name}`, root: '/tv', size: 100, mtimeMs: 1 },
      })
      index().saveProbe({
        id,
        probe: name.includes('720p') ? { ...PROBE, width: 1280, height: 720 } : PROBE,
        tracks: TRACKS,
        chapters: [],
      })
      metadata.link({ mediaIds: [id], itemIds: [episodeId] })
      ids.set(name, id)
    })
  })

  afterAll(database.close)

  it('lists the seasons waiting for detection', () => {
    expect(jobs().seasonsDue()).toHaveLength(2)
  })

  it('finds each episode’s intro, every version of it, and keeps the fingerprints', async () => {
    const { ffmpeg, fingerprint } = fakeFfmpeg()
    const detection = detectionWith({ ffmpeg })
    detection.kick()
    await detection.whenIdle()
    const intro = (name: string) => index().storedMarkers(ids.get(name) ?? -1).intro
    expect(intro('Show - S01E02.mkv')?.source ?? null).toBe(MARKER_SOURCES.fingerprint)
    expect(intro('Show - S01E02.mkv')?.start ?? Number.NaN).toBeCloseTo(120 + RUN_LEAD_S, 0)
    expect(intro('Show - S01E03 (720p).mkv')?.start ?? Number.NaN).toBeCloseTo(75 + RUN_LEAD_S, 0)
    // A season of one episode has nothing to match it against.
    expect(intro('Show - S02E01.mkv')).toBeNull()
    expect(stateOf('Show - S01E01.mkv')).toEqual({
      markers: MARKER_STATES.done,
      markers_version: MARKER_DETECTOR_VERSION,
    })
    expect(stateOf('Show - S02E01.mkv')?.markers ?? null).toBe(MARKER_STATES.done)
    expect(jobs().storedHead(ids.get('Show - S01E01.mkv') ?? -1)?.seconds ?? 0).toBe(600)
    expect(jobs().seasonsDue()).toEqual([])
    // Each head was decoded once, the second version's included.
    expect(fingerprint).toHaveBeenCalledTimes(5)
  })

  it('analyses a replaced file again, against its season mates’ kept fingerprints', async () => {
    const id = ids.get('Show - S01E02.mkv') ?? -1
    index().markChanged({ id, size: 200, mtimeMs: 2 })
    index().saveProbe({ id, probe: PROBE, tracks: TRACKS, chapters: [] })
    expect(stateOf('Show - S01E02.mkv')?.markers ?? null).toBe(MARKER_STATES.pending)
    const { ffmpeg, fingerprint } = fakeFfmpeg()
    const detection = detectionWith({ ffmpeg })
    detection.kick()
    await detection.whenIdle()
    expect(fingerprint).toHaveBeenCalledTimes(1)
    expect(index().storedMarkers(id).intro).not.toBeNull()
  })

  it('does nothing while the admin has detection off', async () => {
    const id = ids.get('Show - S01E01.mkv') ?? -1
    index().markChanged({ id, size: 300, mtimeMs: 3 })
    index().saveProbe({ id, probe: PROBE, tracks: TRACKS, chapters: [] })
    const { ffmpeg, fingerprint } = fakeFfmpeg()
    const detection = detectionWith({ ffmpeg, detectMarkers: false })
    detection.kick()
    await detection.whenIdle()
    expect(fingerprint).not.toHaveBeenCalled()
    expect(stateOf('Show - S01E01.mkv')?.markers ?? null).toBe(MARKER_STATES.pending)
  })

  it('waits while ffmpeg converts a file for someone watching', async () => {
    vi.useFakeTimers()
    try {
      const { ffmpeg, fingerprint, state } = fakeFfmpeg()
      state.isConverting = true
      const detection = detectionWith({ ffmpeg })
      detection.kick()
      await vi.advanceTimersByTimeAsync(YIELD_MS * 3)
      expect(fingerprint).not.toHaveBeenCalled()
      state.isConverting = false
      await vi.advanceTimersByTimeAsync(YIELD_MS)
      await detection.whenIdle()
      expect(fingerprint).toHaveBeenCalled()
      expect(stateOf('Show - S01E01.mkv')?.markers ?? null).toBe(MARKER_STATES.done)
    } finally {
      vi.useRealTimers()
    }
  })
})
