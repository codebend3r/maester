import {
  DEFAULT_PLAYBACK_SETTINGS,
  ITEM_TYPES,
  type ItemType,
  LIBRARY_KINDS,
  MARKER_KINDS,
  MARKER_SOURCES,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readServerConfig } from '@/config'
import type { FfmpegService } from '@/ffmpeg/ffmpegService'
import type { PictureStat } from '@/ffmpeg/pictureStats'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { RUN_LEAD_S } from '@/markers/seasonMatch'
import { MARKER_DETECTOR_VERSION, MarkerJobs } from '@/markers/markerJobs'
import { REGIONS } from '@/markers/seasonListen'
import { ScanControl } from '@/scanner/scanControl'
import { MarkerDetection } from '@/markers/markerDetection'
import { YIELD_MS } from '@/ffmpeg/playbackYield'
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

const END_THEME = noise({ seed: 4343, count: pointsFor(60) })

/** Where each episode's end theme starts; it runs to within 5 s of the file's end. */
const END_THEME_AT = 2335

/** The films: one the crawl score reads, one whose chapters name its credits. */
const FILMS = {
  crawled: 'Film (2020).mkv',
  named: 'Named (2021).mkv',
} as const

const FILM_PROBE = { ...PROBE, duration: 7200 }

/** The crawled film's last frames: picture, then the crawl from 6800 s, then a scene from 7110 s. */
const filmFrames = (start: number): PictureStat[] =>
  Array.from({ length: 7200 - start }, (_, index) => {
    const at = start + index
    const isCrawl = at >= 6800 && at < 7110
    return { at, saturation: isCrawl ? 1 : 40, dark: isCrawl ? 85 : 20 }
  })

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

type DetectionFfmpeg = Pick<FfmpegService, 'fingerprint' | 'pictureStats' | 'isConverting'>

/**
 * ffmpeg as detection uses it: each file's head made up from `INTRO_AT`,
 * each tail with the end theme, the crawled film's frames, and whether a
 * viewer's conversion runs.
 */
const fakeFfmpeg = () => {
  const state = { isConverting: false }
  const fingerprint = vi.fn<FfmpegService['fingerprint']>(async ({ path, start, seconds }) => {
    const name = path.split('/').at(-1) ?? ''
    const at = start === 0 ? (INTRO_AT.get(name) ?? null) : END_THEME_AT - start
    const seed =
      Array.from(name).reduce((hash, char) => (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0, 3) +
      start
    const theme = start === 0 ? THEME : END_THEME
    return at === null
      ? noise({ seed, count: pointsFor(seconds) })
      : withTheme({ seed, seconds, theme, at })
  })
  const pictureStats = vi.fn<FfmpegService['pictureStats']>(async ({ start }) => filmFrames(start))
  const ffmpeg: DetectionFfmpeg = {
    fingerprint,
    pictureStats,
    isConverting: () => state.isConverting,
  }
  return { ffmpeg, fingerprint, pictureStats, state }
}

describe('MarkerDetection', () => {
  const database = testDatabase('raven-marker-detection-')
  const ids = new Map<string, number>()
  const index = () => new MediaIndex(database.get())
  const jobs = () => new MarkerJobs(database.get())
  type DetectionWithProps = {
    ffmpeg: DetectionFfmpeg
    detectMarkers?: boolean
    scans?: ScanControl
  }

  const detectionWith = ({
    ffmpeg,
    detectMarkers = true,
    scans = new ScanControl(),
  }: DetectionWithProps) =>
    new MarkerDetection(
      readServerConfig({}),
      jobs(),
      ffmpeg,
      {
        playback: () => ({ ...DEFAULT_PLAYBACK_SETTINGS, detectMarkers }),
      },
      scans,
    )
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
    const filmsId = new LibrariesRepository(database.get()).create({
      name: 'Films',
      paths: ['/films'],
      settings: { kind: LIBRARY_KINDS.movies },
    }).id
    Object.values(FILMS).forEach((name) => {
      const filmId = metadata.save({ item: fetched({ type: ITEM_TYPES.movie, tmdbId: name }) })
      const id = index().insert({
        libraryId: filmsId,
        kind: LIBRARY_KINDS.movies,
        file: { path: `/films/${name}`, root: '/films', size: 100, mtimeMs: 1 },
      })
      index().saveProbe({
        id,
        probe: FILM_PROBE,
        tracks: TRACKS,
        chapters:
          name === FILMS.named
            ? [
                { start: 0, end: 6600, title: 'Start' },
                { start: 6600, end: 7200, title: 'End Credits' },
              ]
            : [],
      })
      metadata.link({ mediaIds: [id], itemIds: [filmId] })
      ids.set(name, id)
    })
  })

  afterAll(database.close)

  it('lists the seasons and films waiting for detection', () => {
    expect(jobs().seasonsDue()).toHaveLength(2)
    expect(
      jobs()
        .filmsDue()
        .map(({ path }) => path),
    ).toEqual(Object.values(FILMS).map((name) => `/films/${name}`))
  })

  it('finds each episode’s intro and credits, every version of it, and keeps the fingerprints', async () => {
    const { ffmpeg, fingerprint, pictureStats } = fakeFfmpeg()
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
    const first = ids.get('Show - S01E01.mkv') ?? -1
    expect(jobs().stored({ id: first, region: REGIONS.head })?.seconds ?? 0).toBe(600)
    expect(jobs().stored({ id: first, region: REGIONS.tail })?.seconds ?? 0).toBe(360)
    expect(jobs().seasonsDue()).toEqual([])
    // Each head and tail was decoded once, the second version's included.
    expect(fingerprint).toHaveBeenCalledTimes(10)
    // Only the film with no credits chapter has its pictures read.
    expect(pictureStats).toHaveBeenCalledExactlyOnceWith({
      path: `/films/${FILMS.crawled}`,
      start: 6300,
    })
  })

  it('places an episode’s credits on its end theme, running to the file’s end', () => {
    const credits = index().storedMarkers(ids.get('Show - S01E02.mkv') ?? -1).credits
    expect(credits).toMatchObject({
      kind: MARKER_KINDS.credits,
      source: MARKER_SOURCES.fingerprint,
      end: PROBE.duration,
    })
    expect(credits?.start ?? Number.NaN).toBeCloseTo(END_THEME_AT + RUN_LEAD_S, 0)
  })

  it('places a film’s credits on its crawl, and leaves a film with a credits chapter alone', () => {
    const crawled = index().storedMarkers(ids.get(FILMS.crawled) ?? -1).credits
    expect(crawled).toMatchObject({ source: MARKER_SOURCES.visual, start: 6800, end: 7110 })
    expect(index().storedMarkers(ids.get(FILMS.named) ?? -1).credits).toMatchObject({
      source: MARKER_SOURCES.chapter,
      start: 6600,
    })
    expect(stateOf(FILMS.named)?.markers ?? null).toBe(MARKER_STATES.done)
    expect(jobs().filmsDue()).toEqual([])
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
    expect(fingerprint).toHaveBeenCalledTimes(2)
    expect(index().storedMarkers(id).intro).not.toBeNull()
    expect(index().storedMarkers(id).credits).not.toBeNull()
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

  it('manually detects just one library even when automatic detection is off', async () => {
    const libraries = new LibrariesRepository(database.get()).list()
    const tv = libraries.find(({ name }) => name === 'TV')
    const films = libraries.find(({ name }) => name === 'Films')
    if (!tv || !films) throw new Error('Missing test libraries')
    jobs().requestLibrary(tv.id)
    jobs().requestLibrary(films.id)
    const { ffmpeg, pictureStats } = fakeFfmpeg()
    const detection = detectionWith({ ffmpeg, detectMarkers: false })
    expect(detection.scanLibrary(tv.id)).toBe(true)
    await detection.whenIdle()
    expect(jobs().seasonsDue(tv.id)).toEqual([])
    expect(jobs().filmsDue(films.id)).toHaveLength(2)
    expect(pictureStats).not.toHaveBeenCalled()
  })

  it('leaves interrupted detection pending even after scans are allowed again', async () => {
    const { ffmpeg, pictureStats } = fakeFfmpeg()
    let release: (frames: PictureStat[]) => void = () => undefined
    pictureStats.mockImplementation(
      () =>
        new Promise<PictureStat[]>((resolve) => {
          release = resolve
        }),
    )
    const scans = new ScanControl()
    const detection = detectionWith({ ffmpeg, scans })
    detection.kick()
    await vi.waitFor(() => expect(pictureStats).toHaveBeenCalled())
    scans.setStopped(true)
    scans.setStopped(false)
    release([])
    await detection.whenIdle()
    expect(stateOf(FILMS.crawled)?.markers).toBe(MARKER_STATES.pending)
  })

  it('waits while ffmpeg converts a file for someone watching', async () => {
    const id = ids.get('Show - S01E01.mkv') ?? -1
    index().markChanged({ id, size: 400, mtimeMs: 4 })
    index().saveProbe({ id, probe: PROBE, tracks: TRACKS, chapters: [] })
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
