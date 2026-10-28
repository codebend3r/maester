import { type Fingerprint, type SharedRun, sharedRun } from '@/markers/fingerprintMatch'

/** Two runs starting within this many seconds of each other are the same one. */
const AGREE_S = 2

/** Below this share of partners agreeing, an episode gets no run. */
const MIN_CONFIDENCE = 0.5

/** One episode's fingerprint over the stretch being matched: its head for intros, its tail for credits. */
export type SeasonEpisode = { id: number; heard: Fingerprint }

/** The run an episode shares with its season mates, in seconds of its file, and the share of its partners that agree. */
export type FoundRun = { start: number; end: number; confidence: number }

type PartnersOfProps = { index: number; count: number }

/**
 * The episodes an episode is compared with: the one before, the one after,
 * and the one halfway round the season, so a single odd episode next to it
 * does not break the chain. Positions, in the season's order.
 */
const partnersOf = ({ index, count }: PartnersOfProps): number[] => {
  const across = (index + Math.floor(count / 2)) % count
  return Array.from(new Set([index - 1, index + 1, across])).filter(
    (other) => other >= 0 && other < count && other !== index,
  )
}

type PairKeyProps = { a: number; b: number }

const pairKey = ({ a, b }: PairKeyProps): string => (a < b ? `${a}:${b}` : `${b}:${a}`)

/** One episode's side of a run it shares with a partner. */
type Side = { start: number; end: number }

type SideOfProps = { run: SharedRun; isOwn: boolean }

const sideOf = ({ run, isOwn }: SideOfProps): Side =>
  isOwn ? { start: run.start, end: run.end } : { start: run.theirStart, end: run.theirEnd }

type MatchSeasonProps = {
  episodes: readonly SeasonEpisode[]
  /** The shortest and longest run worth keeping, in seconds. */
  bounds: { min: number; max: number }
}

/**
 * The run of audio each episode of one season shares with the others: the
 * intro near their start, the end theme near their end. Each episode is
 * compared with its partners; its run is the one the most partners agree on
 * (starting within 2 s), the longest of those, and its confidence the share
 * of partners that agree. An episode whose confidence falls short, or which
 * shares nothing, gets none: a wrong marker costs more than a missing one.
 */
export const matchSeason = ({ episodes, bounds }: MatchSeasonProps): Map<number, FoundRun> => {
  const count = episodes.length
  const pairs = new Map<string, SharedRun | null>()
  type RunBetweenProps = { a: number; b: number }

  const runBetween = ({ a, b }: RunBetweenProps): Side | null => {
    const key = pairKey({ a, b })
    const first = Math.min(a, b)
    const second = Math.max(a, b)
    const cached = pairs.get(key)
    const run =
      cached !== undefined
        ? cached
        : sharedRun({
            own: episodes[first]?.heard ?? { start: 0, points: [] },
            theirs: episodes[second]?.heard ?? { start: 0, points: [] },
            bounds,
          })
    pairs.set(key, run)
    return run == null ? null : sideOf({ run, isOwn: a === first })
  }
  return episodes.reduce((found, episode, index) => {
    const partners = partnersOf({ index, count })
    const sides = partners.flatMap((other) => {
      const side = runBetween({ a: index, b: other })
      return side == null ? [] : [side]
    })
    const best = sides
      .map((side) => ({
        side,
        agreeing: sides.filter((other) => Math.abs(other.start - side.start) <= AGREE_S),
      }))
      .toSorted(
        (a, b) =>
          b.agreeing.length - a.agreeing.length ||
          b.side.end - b.side.start - (a.side.end - a.side.start),
      )[0]
    if (best == null || partners.length === 0) return found
    const confidence = best.agreeing.length / partners.length
    if (confidence < MIN_CONFIDENCE) return found
    return found.set(episode.id, { start: best.side.start, end: best.side.end, confidence })
  }, new Map<number, FoundRun>())
}

/** A chapter start this close wins over the audio's own boundary. */
const CHAPTER_SNAP_S = 10

/**
 * How far a run's times lead the sound they describe. Each Chromaprint
 * point sums up the two seconds or so of audio after its timestamp, so a
 * run starts and ends about a second early. On the spike's 30 labelled
 * intros, 0.75 s puts the most boundaries on the label (26 of 30 within
 * 2 s); anything from 0.5 to 2 s does nearly as well.
 */
export const RUN_LEAD_S = 0.75

type NearestProps = { time: number; among: readonly number[] }

const nearest = ({ time, among }: NearestProps): number | null =>
  among.reduce<number | null>(
    (best, at) => (best == null || Math.abs(at - time) < Math.abs(best - time) ? at : best),
    null,
  )

type SnapBoundaryProps = {
  time: number
  /** Where the file's chapters start, in seconds. */
  chapterStarts: readonly number[]
}

/**
 * Where a boundary the audio found really is: a chapter start within 10 s
 * when the file has one there (chapters sit on the cut), else the audio's
 * time moved past the run's lead. Snapping to the nearest shot change
 * instead, as spike 1 planned, measured worse (16 of 30): an intro is all
 * cuts, and the nearest is often inside it.
 */
export const snapBoundary = ({ time, chapterStarts }: SnapBoundaryProps): number =>
  nearest({
    time,
    among: chapterStarts.filter((at) => Math.abs(at - time) <= CHAPTER_SNAP_S),
  }) ?? time + RUN_LEAD_S
