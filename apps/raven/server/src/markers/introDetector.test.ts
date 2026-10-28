import { MARKER_KINDS, MARKER_SOURCES } from '@raven/core'
import { describe, expect, it, vi } from 'vitest'
import type { FingerprintTools } from '@/markers/fingerprintMatch'
import { detectSeasonIntros } from '@/markers/introDetector'
import type { SeasonFile } from '@/markers/seasonListen'
import { RUN_LEAD_S, matchSeason, snapBoundary } from '@/markers/seasonMatch'
import { noise, pointsFor, withTheme } from '@/test/fingerprints'

const THEME = noise({ seed: 99, count: pointsFor(50) })

const BOUNDS = { min: 15, max: 130 }

type EpisodeProps = { id: number; at: number | null; seconds?: number }

/** An episode's head, its intro (the shared theme) at `at` seconds, or none. */
const episode = ({ id, at, seconds = 600 }: EpisodeProps) => ({
  id,
  heard: {
    start: 0,
    points:
      at === null
        ? noise({ seed: id, count: pointsFor(seconds) })
        : withTheme({ seed: id, seconds, theme: THEME, at }),
  },
})

describe('matchSeason', () => {
  it("finds each episode's intro, wherever its cold open puts it", () => {
    const found = matchSeason({
      episodes: [
        episode({ id: 1, at: 0 }),
        episode({ id: 2, at: 43 }),
        episode({ id: 3, at: 360 }),
      ],
      bounds: BOUNDS,
    })
    expect(found.get(2)?.start ?? Number.NaN).toBeCloseTo(43, 0)
    expect(found.get(3)?.start ?? Number.NaN).toBeCloseTo(360, 0)
    expect(found.get(1)?.confidence ?? 0).toBe(1)
  })

  it('gives an episode with no intro none, and its season mates still theirs', () => {
    const found = matchSeason({
      episodes: [
        episode({ id: 1, at: 60 }),
        episode({ id: 2, at: null }),
        episode({ id: 3, at: 90 }),
        episode({ id: 4, at: 75 }),
      ],
      bounds: BOUNDS,
    })
    expect(found.has(2)).toBe(false)
    expect(found.get(3)?.start ?? Number.NaN).toBeCloseTo(90, 0)
  })

  it('finds nothing in a season of one episode, or of episodes that share nothing', () => {
    expect(matchSeason({ episodes: [episode({ id: 1, at: 60 })], bounds: BOUNDS }).size).toBe(0)
    expect(
      matchSeason({
        episodes: [
          episode({ id: 1, at: null }),
          episode({ id: 2, at: null }),
          episode({ id: 3, at: null }),
        ],
        bounds: BOUNDS,
      }).size,
    ).toBe(0)
  })
})

describe('snapBoundary', () => {
  it('takes a chapter start within 10 s, else moves past the run’s lead', () => {
    expect(snapBoundary({ time: 85.6, chapterStarts: [0, 90, 675] })).toBe(90)
    expect(snapBoundary({ time: 70, chapterStarts: [0, 90] })).toBe(70 + RUN_LEAD_S)
    expect(snapBoundary({ time: 70, chapterStarts: [] })).toBe(70 + RUN_LEAD_S)
  })
})

type FakeToolsProps = { at: ReadonlyMap<string, number | null>; failing?: ReadonlySet<string> }

/** ffmpeg as detection uses it, over made up files: each path's theme at its seconds, heard as far as asked. */
const fakeTools = ({ at, failing = new Set() }: FakeToolsProps) => ({
  fingerprint: vi.fn<FingerprintTools['fingerprint']>(async ({ path, seconds }) => {
    if (failing.has(path)) throw new Error('No audio stream')
    const theme = at.get(path) ?? null
    const seed = Array.from(path).reduce(
      (hash, char) => (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0,
      7,
    )
    return theme === null
      ? noise({ seed, count: pointsFor(seconds) })
      : withTheme({ seed, seconds, theme: THEME, at: theme })
  }),
})

type FileProps = { id: number; chapterStarts?: number[]; duration?: number }

const file = ({ id, chapterStarts = [], duration = 2400 }: FileProps): SeasonFile => ({
  id,
  path: `/tv/Show/Season 1/Episode ${id}.mkv`,
  duration,
  chapterStarts,
})

describe('detectSeasonIntros', () => {
  it('fingerprints each head, keeps it, and returns each intro as a fingerprint marker', async () => {
    const files = [file({ id: 1 }), file({ id: 2, chapterStarts: [0, 130] }), file({ id: 3 })]
    const tools = fakeTools({
      at: new Map(files.map(({ path }, index) => [path, [40, 80, 200][index] ?? null])),
    })
    const kept = vi.fn()
    const { markers: intros, failed } = await detectSeasonIntros({
      files,
      kept: new Map(),
      tools,
      onMade: kept,
    })
    expect(failed.size).toBe(0)
    expect(kept).toHaveBeenCalledTimes(3)
    expect(tools.fingerprint).toHaveBeenCalledWith({
      path: files[0]?.path ?? '',
      start: 0,
      seconds: 600,
    })
    expect(intros.get(1)).toMatchObject({
      kind: MARKER_KINDS.intro,
      source: MARKER_SOURCES.fingerprint,
      confidence: 1,
    })
    expect(intros.get(1)?.start ?? Number.NaN).toBeCloseTo(40 + RUN_LEAD_S, 0)
    // A chapter start near the end wins.
    expect(intros.get(2)?.end ?? Number.NaN).toBe(130)
  })

  it('reads a kept head rather than decoding it again', async () => {
    const files = [file({ id: 1 }), file({ id: 2 }), file({ id: 3 })]
    const kept = new Map(
      files.map(({ id }) => [
        id,
        { seconds: 600, points: withTheme({ seed: id, seconds: 600, theme: THEME, at: 30 * id }) },
      ]),
    )
    const tools = fakeTools({ at: new Map() })
    const { markers: intros } = await detectSeasonIntros({ files, kept, tools, onMade: () => {} })
    expect(tools.fingerprint).not.toHaveBeenCalled()
    expect(intros.size).toBe(3)
  })

  it('hears an episode again over a wider window when its intro starts past the first', async () => {
    const files = [file({ id: 1 }), file({ id: 2 }), file({ id: 3 })]
    const tools = fakeTools({
      at: new Map(files.map(({ path }, index) => [path, [189, 719, 300][index] ?? null])),
    })
    const { markers: intros } = await detectSeasonIntros({
      files,
      kept: new Map(),
      tools,
      onMade: () => {},
    })
    expect(tools.fingerprint).toHaveBeenCalledWith({
      path: files[1]?.path ?? '',
      start: 0,
      seconds: 800,
    })
    expect(intros.get(2)?.start ?? Number.NaN).toBeCloseTo(719 + RUN_LEAD_S, 0)
  })

  it('leaves out an episode whose audio cannot be read, and lists it as failed', async () => {
    const files = [file({ id: 1 }), file({ id: 2 }), file({ id: 3 }), file({ id: 4 })]
    const tools = fakeTools({
      at: new Map(files.map(({ path }) => [path, 60])),
      failing: new Set([files[1]?.path ?? '']),
    })
    const { markers: intros, failed } = await detectSeasonIntros({
      files,
      kept: new Map(),
      tools,
      onMade: () => {},
    })
    expect(failed).toEqual(new Set([2]))
    expect(Array.from(intros.keys()).toSorted()).toEqual([1, 3, 4])
  })
})
