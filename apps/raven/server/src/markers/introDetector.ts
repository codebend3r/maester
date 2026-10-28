import { MARKER_KINDS, MARKER_SOURCES, type Marker } from '@raven/core'
import {
  type HeardSeason,
  type ListenWindow,
  type PlacedRun,
  type SeasonDetectorInput,
  type SeasonFile,
  type SeasonMarkers,
  hearSeason,
  markersOf,
} from '@/markers/seasonListen'
import { type FoundRun, matchSeason, snapBoundary } from '@/markers/seasonMatch'

/** An intro runs this long at most; anything longer is a recap or a shared scene. */
const INTRO_BOUNDS = { min: 15, max: 130 } as const

/** The first pass listens to the first quarter, or 10 minutes, whichever is shorter. */
const headSeconds = (duration: number): number => Math.min(duration * 0.25, 600)

/**
 * The second pass, for an episode the first left without an intro while its
 * season mates found theirs: a third, or 15 minutes (Severance's intro
 * starts 26% in).
 */
const wideSeconds = (duration: number): number => Math.min(duration / 3, 900)

const fromStart = (seconds: number): ListenWindow => ({ seconds, startOf: () => 0 })

type DetectSeasonIntrosProps = SeasonDetectorInput

/**
 * The intro of each episode of a season. Each episode's head is
 * fingerprinted (or its kept fingerprint read), the season matched
 * (`matchSeason`), an episode left without an intro while its season mates
 * found theirs heard again over a wider window, and both ends of each intro
 * placed (`snapBoundary`). An episode whose audio cannot be read is left
 * out and listed as failed; the rest go on without it.
 */
export const detectSeasonIntros = async ({
  files,
  kept,
  tools,
  onMade,
  only,
}: DetectSeasonIntrosProps): Promise<SeasonMarkers> => {
  const first = await hearSeason({
    files,
    kept,
    tools,
    onMade,
    windowOf: ({ duration }) => fromStart(headSeconds(duration)),
  })
  const found = matchSeason({ episodes: first.heard, bounds: INTRO_BOUNDS })
  const missing = files.filter(
    ({ id, duration }) =>
      !found.has(id) && !first.failed.has(id) && wideSeconds(duration) > headSeconds(duration) + 1,
  )
  const all =
    found.size === 0 || missing.length === 0
      ? { found, failed: first.failed }
      : await secondPass({ first, found, missing, input: { files, kept, tools, onMade } })
  return {
    markers: markersOf({ files, found: all.found, only, markerOf: introMarker }),
    failed: all.failed,
  }
}

type SecondPassProps = {
  first: HeardSeason
  found: ReadonlyMap<number, FoundRun>
  missing: readonly SeasonFile[]
  input: Omit<SeasonDetectorInput, 'only'>
}

/** Hears each missing episode over the wider window and matches the season again, keeping only what that finds for them. */
const secondPass = async ({ first, found, missing, input }: SecondPassProps) => {
  const wide = await hearSeason({
    ...input,
    files: missing,
    windowOf: ({ duration }) => fromStart(wideSeconds(duration)),
  })
  const widened = new Map(wide.heard.map(({ id, heard }) => [id, heard]))
  const again = matchSeason({
    episodes: first.heard.map(({ id, heard }) => ({ id, heard: widened.get(id) ?? heard })),
    bounds: INTRO_BOUNDS,
  })
  return {
    found: missing.reduce((all, { id }) => {
      const run = again.get(id)
      return run == null ? all : all.set(id, run)
    }, new Map(found)),
    failed: new Set([...first.failed, ...wide.failed]),
  }
}

type IntroMarkerProps = PlacedRun

/** The intro as a marker, both ends placed. */
const introMarker = ({ run, file }: IntroMarkerProps): Marker => ({
  kind: MARKER_KINDS.intro,
  start: snapBoundary({ time: run.start, chapterStarts: file.chapterStarts }),
  end: snapBoundary({ time: run.end, chapterStarts: file.chapterStarts }),
  source: MARKER_SOURCES.fingerprint,
  confidence: run.confidence,
})
