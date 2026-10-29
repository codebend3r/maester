import { MARKER_KINDS, MARKER_SOURCES } from '@raven/core'
import { describe, expect, it, vi } from 'vitest'
import type { PictureStat } from '@/ffmpeg/pictureStats'
import { creditsCrawl } from '@/markers/creditCrawl'
import {
  type PictureTools,
  detectFilmCredits,
  detectSeasonCredits,
} from '@/markers/creditsDetector'
import type { FingerprintTools } from '@/markers/fingerprintMatch'
import type { SeasonFile } from '@/markers/seasonListen'
import { RUN_LEAD_S } from '@/markers/seasonMatch'
import { noise, pointsFor, withTheme } from '@/test/fingerprints'

const END_THEME = noise({ seed: 77, count: pointsFor(40) })

type Look = Omit<PictureStat, 'at'>

const LOOKS = {
  picture: { saturation: 40, dark: 20 },
  crawl: { saturation: 1, dark: 85 },
  black: { saturation: 0, dark: 100 },
  grey: { saturation: 1, dark: 30 },
} as const satisfies Record<string, Look>

type Span = { from: number; to: number; look: Look }

type FramesProps = { from: number; to: number; spans: readonly Span[] }

/** One frame a second from `from` to `to`, the first span over each second giving its look, picture elsewhere. */
const frames = ({ from, to, spans }: FramesProps) =>
  Array.from({ length: to - from }, (_, index): PictureStat => {
    const at = from + index
    const look = spans.find((span) => at >= span.from && at < span.to)?.look ?? LOOKS.picture
    return { at, ...look }
  })

describe('creditsCrawl', () => {
  it('starts the credits at the crawl, with a scene after it', () => {
    const found = creditsCrawl(
      frames({
        from: 6000,
        to: 7000,
        spans: [
          { from: 6500, to: 6900, look: LOOKS.crawl },
          { from: 6900, to: 6905, look: LOOKS.black },
        ],
      }),
    )
    expect(found).toEqual({ start: 6500, sceneAt: 6905 })
  })

  it('pulls in a shorter run of crawl just before the longest, and passes over a short gap', () => {
    const found = creditsCrawl(
      frames({
        from: 6000,
        to: 7000,
        spans: [
          // A card of colour inside the crawl, shorter than a gap that splits it.
          { from: 6370, to: 6375, look: LOOKS.picture },
          { from: 6300, to: 6340, look: LOOKS.crawl },
          { from: 6360, to: 7000, look: LOOKS.crawl },
        ],
      }),
    )
    expect(found).toEqual({ start: 6300, sceneAt: null })
  })

  it('finds nothing without a crawl, or in a black and white film', () => {
    expect(creditsCrawl(frames({ from: 0, to: 900, spans: [] }))).toBeNull()
    expect(
      creditsCrawl(frames({ from: 0, to: 900, spans: [{ from: 0, to: 900, look: LOOKS.grey }] })),
    ).toBeNull()
    expect(creditsCrawl([])).toBeNull()
  })
})

type TailToolsProps = { at: ReadonlyMap<string, number | null> }

/** ffmpeg over made up episodes: each tail with the end theme at its file's second, or none. */
const tailTools = ({ at }: TailToolsProps) => ({
  fingerprint: vi.fn<FingerprintTools['fingerprint']>(async ({ path, start, seconds }) => {
    const theme = at.get(path) ?? null
    const seed = Array.from(path).reduce(
      (hash, char) => (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0,
      11,
    )
    return theme === null
      ? noise({ seed, count: pointsFor(seconds) })
      : withTheme({ seed, seconds, theme: END_THEME, at: theme - start })
  }),
})

type EpisodeProps = { id: number; duration?: number }

const episode = ({ id, duration = 2400 }: EpisodeProps): SeasonFile => ({
  id,
  path: `/tv/Show/Season 1/Episode ${id}.mkv`,
  duration,
  chapterStarts: [],
})

describe('detectSeasonCredits', () => {
  it('places each episode’s credits on the end theme it shares, and keeps each tail', async () => {
    const episodes = [episode({ id: 1 }), episode({ id: 2 }), episode({ id: 3 })]
    const tools = tailTools({
      at: new Map(episodes.map(({ path }, index) => [path, [2356, 2300, 2200][index] ?? null])),
    })
    const kept = vi.fn()
    const { markers: credits, failed } = await detectSeasonCredits({
      files: episodes,
      kept: new Map(),
      tools,
      onMade: kept,
    })
    expect(failed.size).toBe(0)
    expect(kept).toHaveBeenCalledTimes(3)
    expect(tools.fingerprint).toHaveBeenCalledWith({
      path: episodes[0]?.path ?? '',
      start: 2040,
      seconds: 360,
    })
    expect(credits.get(1)).toMatchObject({
      kind: MARKER_KINDS.credits,
      source: MARKER_SOURCES.fingerprint,
      confidence: 1,
      // The theme ends 4 s before the file does: too short for a scene, so the credits run on.
      end: 2400,
    })
    expect(credits.get(1)?.start ?? Number.NaN).toBeCloseTo(2356 + RUN_LEAD_S, 0)
    // Two minutes of story after the theme: the credits end where it does.
    expect(credits.get(3)?.end ?? Number.NaN).toBeCloseTo(2240 + RUN_LEAD_S, 0)
  })

  it('reads a kept tail rather than decoding it again', async () => {
    const tools = tailTools({ at: new Map() })
    const kept = new Map(
      [1, 2, 3].map((id) => [
        id,
        {
          seconds: 360,
          points: withTheme({ seed: id, seconds: 360, theme: END_THEME, at: 100 + id * 20 }),
        },
      ]),
    )
    const { markers: credits } = await detectSeasonCredits({
      files: [1, 2, 3].map((id) => episode({ id })),
      kept,
      tools,
      onMade: () => {},
    })
    expect(tools.fingerprint).not.toHaveBeenCalled()
    expect(credits.get(2)?.start ?? Number.NaN).toBeCloseTo(2040 + 140 + RUN_LEAD_S, 0)
  })

  it('gives a season with no shared end theme no credits', async () => {
    const episodes = [episode({ id: 1 }), episode({ id: 2 }), episode({ id: 3 })]
    const { markers: credits } = await detectSeasonCredits({
      files: episodes,
      kept: new Map(),
      tools: tailTools({ at: new Map() }),
      onMade: () => {},
    })
    expect(credits.size).toBe(0)
  })
})

describe('detectFilmCredits', () => {
  const tools = (stats: PictureStat[]) => ({
    pictureStats: vi.fn<PictureTools['pictureStats']>(async () => stats),
  })

  it('scores the last 15 minutes and returns the crawl as a visual marker', async () => {
    const film = tools(
      frames({ from: 6300, to: 7200, spans: [{ from: 6800, to: 7200, look: LOOKS.crawl }] }),
    )
    const marker = await detectFilmCredits({ path: '/films/A.mkv', duration: 7200, tools: film })
    expect(film.pictureStats).toHaveBeenCalledWith({ path: '/films/A.mkv', start: 6300 })
    expect(marker).toEqual({
      kind: MARKER_KINDS.credits,
      start: 6800,
      end: 7200,
      source: MARKER_SOURCES.visual,
      confidence: 0.5,
    })
  })

  it('finds no credits where the score sees no crawl', async () => {
    const film = tools(frames({ from: 6300, to: 7200, spans: [] }))
    expect(
      await detectFilmCredits({ path: '/films/B.mkv', duration: 7200, tools: film }),
    ).toBeNull()
  })
})
