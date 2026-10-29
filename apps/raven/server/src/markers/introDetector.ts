import { MARKER_KINDS, MARKER_SOURCES, type Marker } from '@raven/core'
import type { Fingerprint } from '@/markers/fingerprintMatch'
import {
  type FoundIntro,
  type SeasonEpisode,
  seasonIntros,
  snapBoundary,
} from '@/markers/seasonIntros'

/** A stretch of a file to analyse, in seconds. */
type Stretch = { path: string; start: number; seconds: number }

/** What detection needs ffmpeg for: `FfmpegService`, or a stand-in in tests. */
export type IntroTools = {
  fingerprint: (stretch: Stretch) => Promise<number[]>
}

/** A kept head fingerprint: how many seconds from the start it covers, and its points. */
export type StoredHead = { seconds: number; points: readonly number[] }

/** One episode of a season, in the season's order. */
export type DetectEpisode = {
  id: number
  path: string
  duration: number
  /** Where the file's chapters start, in seconds. */
  chapterStarts: readonly number[]
  /** Its kept head fingerprint, or null when none is kept. */
  head: StoredHead | null
}

/** The first pass listens to the first quarter, or 10 minutes, whichever is shorter. */
const headSeconds = (duration: number): number => Math.min(duration * 0.25, 600)

/**
 * The second pass, for an episode the first left without an intro while its
 * season mates found theirs: a third, or 15 minutes (Severance's intro
 * starts 26% in).
 */
const wideSeconds = (duration: number): number => Math.min(duration / 3, 900)

type DetectSeasonIntrosProps = {
  episodes: readonly DetectEpisode[]
  tools: IntroTools
  /** Told each fingerprint made, to keep it. */
  onHead: (head: KeptHead) => void
  /** The episodes whose intros are wanted; the rest only lend their audio. All, when left out. */
  only?: ReadonlySet<number>
}

/** A head fingerprint just made, and whose it is. */
type KeptHead = StoredHead & { id: number }

type HeadOfProps = { episode: DetectEpisode; seconds: number }

/** The intro of each episode found, and the episodes that could not be analysed. */
export type SeasonDetection = { intros: Map<number, Marker>; failed: Set<number> }

/**
 * The intro of each episode of a season. Each episode's head is
 * fingerprinted (or its kept fingerprint read), the season matched
 * (`seasonIntros`), an episode left without an intro while its season mates
 * found theirs heard again over a wider window, and both ends of each intro
 * moved onto a clean cut: a chapter start within 10 s, else a shot change
 * within 8 s. An episode whose audio cannot be read is left out and listed
 * as failed; the rest go on without it.
 */
export const detectSeasonIntros = async ({
  episodes,
  tools,
  onHead,
  only,
}: DetectSeasonIntrosProps): Promise<SeasonDetection> => {
  const failed = new Set<number>()
  const headOf = async ({ episode, seconds }: HeadOfProps): Promise<Fingerprint | null> => {
    if (episode.head != null && episode.head.seconds >= seconds - 1) {
      return { start: 0, points: episode.head.points }
    }
    try {
      const points = await tools.fingerprint({ path: episode.path, start: 0, seconds })
      onHead({ id: episode.id, seconds, points })
      return { start: 0, points }
    } catch {
      failed.add(episode.id)
      return null
    }
  }
  const heads = await episodes.reduce<Promise<SeasonEpisode[]>>(async (previous, episode) => {
    const listened = await previous
    const head = await headOf({ episode, seconds: headSeconds(episode.duration) })
    return head == null ? listened : [...listened, { id: episode.id, head }]
  }, Promise.resolve([]))
  const first = seasonIntros(heads)
  const missing = episodes.filter(
    (episode) =>
      !first.has(episode.id) &&
      !failed.has(episode.id) &&
      wideSeconds(episode.duration) > headSeconds(episode.duration) + 1,
  )
  const found =
    first.size === 0 || missing.length === 0
      ? first
      : await secondPass({ heads, first, missing, headOf })
  const intros = episodes.reduce((done, episode) => {
    const intro = found.get(episode.id)
    if (intro == null || (only !== undefined && !only.has(episode.id))) return done
    return done.set(episode.id, markerOf({ intro, chapterStarts: episode.chapterStarts }))
  }, new Map<number, Marker>())
  return { intros, failed }
}

type SecondPassProps = {
  heads: readonly SeasonEpisode[]
  first: Map<number, FoundIntro>
  missing: readonly DetectEpisode[]
  headOf: (head: HeadOfProps) => Promise<Fingerprint | null>
}

/** Hears each missing episode over the wider window and matches the season again, keeping only what that finds for them. */
const secondPass = async ({
  heads,
  first,
  missing,
  headOf,
}: SecondPassProps): Promise<Map<number, FoundIntro>> => {
  const widened = await missing.reduce<Promise<Map<number, Fingerprint>>>(
    async (previous, episode) => {
      const wide = await previous
      const head = await headOf({ episode, seconds: wideSeconds(episode.duration) })
      return head == null ? wide : wide.set(episode.id, head)
    },
    Promise.resolve(new Map()),
  )
  const again = seasonIntros(heads.map(({ id, head }) => ({ id, head: widened.get(id) ?? head })))
  return missing.reduce((found, { id }) => {
    const intro = again.get(id)
    return intro == null ? found : found.set(id, intro)
  }, new Map(first))
}

type MarkerOfProps = { intro: FoundIntro; chapterStarts: readonly number[] }

/** The intro as a marker, both ends where the picture changes. */
const markerOf = ({ intro, chapterStarts }: MarkerOfProps): Marker => ({
  kind: MARKER_KINDS.intro,
  start: snapBoundary({ time: intro.start, chapterStarts }),
  end: snapBoundary({ time: intro.end, chapterStarts }),
  source: MARKER_SOURCES.fingerprint,
  confidence: intro.confidence,
})
