import type { PictureStat } from '@/ffmpeg/pictureStats'

/** A crawl frame's mean saturation is at most this: white text on black has next to no colour. */
const CRAWL_SATURATION = 3

/** A crawl frame has at least this share of dark pixels, in percent. */
const CRAWL_DARK = 60

/** A frame this dark is a fade to black, not crawl or picture. */
const BLACK = 99.5

/** Crawl frames this far apart, in seconds, still belong to one run (a card of names held longer). */
const CRAWL_GAP_S = 12

/** The shortest run of crawl that counts, in seconds. */
const CRAWL_MIN_S = 30

/** A shorter run of crawl ending this close before the longest is part of the credits too. */
const PULL_IN_S = 45

/** Picture frames this far apart, in seconds, still belong to one scene. */
const SCENE_GAP_S = 3

/** Picture after the credits this long or longer, in seconds, is a scene; shorter is a logo. */
const SCENE_MIN_S = 10

/** Above this share of colourless frames the film is black and white, and the score cannot tell crawl from picture. */
const MONOCHROME_SHARE = 0.8

type Run = { from: number; to: number }

type RunsOfProps = { times: readonly number[]; gap: number; min: number }

/** The times joined into runs across gaps up to `gap`, keeping those at least `min` long. */
const runsOf = ({ times, gap, min }: RunsOfProps): Run[] =>
  times
    .reduce<Run[]>((runs, at) => {
      const last = runs.at(-1)
      if (last !== undefined && at - last.to <= gap) {
        return runs.with(runs.length - 1, { from: last.from, to: at })
      }
      return [...runs, { from: at, to: at }]
    }, [])
    .filter(({ from, to }) => to - from >= min)

/** Where a film's credits start by its crawl, and where a scene after them starts, if one does. */
export type Crawl = { start: number; sceneAt: number | null }

/**
 * The credits crawl in a film's last frames (spike 2): frames nearly
 * colourless and mostly dark, joined into runs; the longest is the crawl,
 * and shorter runs ending within 45 s before it are pulled in. The credits
 * have started by then at the latest: title cards, photos or art before the
 * crawl make this late, never early. Picture of 10 s or more after the
 * crawl is a scene after the credits. Null when there is no crawl, or the
 * film is black and white.
 */
export const creditsCrawl = (frames: readonly PictureStat[]): Crawl | null => {
  const looks = frames.map(({ at, saturation, dark }) => ({
    at,
    isGrey: saturation <= CRAWL_SATURATION,
    isCrawl: saturation <= CRAWL_SATURATION && dark >= CRAWL_DARK && dark < BLACK,
    isBlack: dark >= BLACK,
  }))
  if (looks.length === 0) return null
  if (looks.filter(({ isGrey }) => isGrey).length > looks.length * MONOCHROME_SHARE) return null
  const runs = runsOf({
    times: looks.filter(({ isCrawl }) => isCrawl).map(({ at }) => at),
    gap: CRAWL_GAP_S,
    min: CRAWL_MIN_S,
  })
  const crawl = runs.toSorted((a, b) => b.to - b.from - (a.to - a.from))[0]
  if (crawl === undefined) return null
  const start = runs
    .filter(({ to }) => to <= crawl.from)
    .toReversed()
    .reduce((from, run) => (from - run.to <= PULL_IN_S ? run.from : from), crawl.from)
  const scene = runsOf({
    times: looks
      .filter(({ at, isCrawl, isBlack }) => at > crawl.to && !isCrawl && !isBlack)
      .map(({ at }) => at),
    gap: SCENE_GAP_S,
    min: SCENE_MIN_S,
  })[0]
  return { start, sceneAt: scene?.from ?? null }
}
