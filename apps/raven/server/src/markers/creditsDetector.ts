import { MARKER_KINDS, MARKER_SOURCES, type Marker } from '@raven/core'
import type { PictureStat } from '@/ffmpeg/pictureStats'
import { creditsCrawl } from '@/markers/creditCrawl'
import {
  type PlacedRun,
  type SeasonDetectorInput,
  type SeasonMarkers,
  hearSeason,
  markersOf,
} from '@/markers/seasonListen'
import { matchSeason, snapBoundary } from '@/markers/seasonMatch'

/** An end theme runs this long at most; spike 2 saw them up to five and a half minutes. */
const END_THEME_BOUNDS = { min: 15, max: 330 } as const

/** An end theme ending this close to the file's end, in seconds, runs to it: what follows is a logo, not a scene. */
const ROLL_TO_END_S = 10

/** An episode's tail: its last fifth, or 6 minutes, whichever is shorter. */
const tailSeconds = (duration: number): number => Math.min(duration * 0.2, 360)

/** A film's crawl is looked for in its last 15 minutes, or its second half when shorter. */
const filmTailSeconds = (duration: number): number => Math.min(900, duration / 2)

/**
 * How sure a crawl marker is. Spike 2 found the crawl never starts before
 * the credits do, but often well after (title cards before it), so the
 * marker is safe to count down from and not trusted further.
 */
const CRAWL_CONFIDENCE = 0.5

type DetectSeasonCreditsProps = SeasonDetectorInput

/**
 * The credits of each episode of a season, by the end theme its episodes
 * share: each tail is fingerprinted (or its kept fingerprint read) and the
 * season matched (`matchSeason`). A show that plays a song or new score
 * over its credits shares no theme, and its episodes get no marker; they
 * roll on at the file's end as before. An episode whose audio cannot be
 * read is left out and listed as failed.
 */
export const detectSeasonCredits = async ({
  files,
  kept,
  tools,
  onMade,
  only,
}: DetectSeasonCreditsProps): Promise<SeasonMarkers> => {
  const { heard, failed } = await hearSeason({
    files,
    kept,
    tools,
    onMade,
    windowOf: ({ duration }) => ({
      seconds: tailSeconds(duration),
      startOf: (seconds) => Math.max(0, duration - seconds),
    }),
  })
  const found = matchSeason({ episodes: heard, bounds: END_THEME_BOUNDS })
  return { markers: markersOf({ files, found, only, markerOf: endThemeMarker }), failed }
}

type EndThemeMarkerProps = PlacedRun

/** The end theme as a credits marker, both ends placed. */
const endThemeMarker = ({ run, file }: EndThemeMarkerProps): Marker => {
  const end = snapBoundary({ time: run.end, chapterStarts: file.chapterStarts })
  return {
    kind: MARKER_KINDS.credits,
    start: snapBoundary({ time: run.start, chapterStarts: file.chapterStarts }),
    end: file.duration - end < ROLL_TO_END_S ? file.duration : end,
    source: MARKER_SOURCES.fingerprint,
    confidence: run.confidence,
  }
}

/** A film's tail to score, from `start` seconds in to its end. */
type FilmTail = { path: string; start: number }

/** What film detection needs ffmpeg for: `FfmpegService`, or a stand-in in tests. */
export type PictureTools = {
  pictureStats: (tail: FilmTail) => Promise<PictureStat[]>
}

type DetectFilmCreditsProps = { path: string; duration: number; tools: PictureTools }

/**
 * A film's credits by its crawl (`creditsCrawl`), from the crawl's start to
 * a scene after it or the file's end. Null when the score finds no crawl;
 * the film then rolls on at its end, as before.
 */
export const detectFilmCredits = async ({
  path,
  duration,
  tools,
}: DetectFilmCreditsProps): Promise<Marker | null> => {
  const crawl = creditsCrawl(
    await tools.pictureStats({ path, start: Math.max(0, duration - filmTailSeconds(duration)) }),
  )
  if (crawl === null) return null
  return {
    kind: MARKER_KINDS.credits,
    start: crawl.start,
    end: crawl.sceneAt ?? duration,
    source: MARKER_SOURCES.visual,
    confidence: CRAWL_CONFIDENCE,
  }
}
