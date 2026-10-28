import type { Marker } from '@raven/core'
import type {
  Fingerprint,
  FingerprintTools,
  KeptFingerprint,
  MadeFingerprint,
} from '@/markers/fingerprintMatch'
import type { FoundRun, SeasonEpisode } from '@/markers/seasonMatch'

/** The regions of a file detection listens to and keeps fingerprints of: from its start, or up to its end. */
export const REGIONS = { head: 'head', tail: 'tail' } as const

export type Region = (typeof REGIONS)[keyof typeof REGIONS]

/** One file of a season, as the detectors read it. */
export type SeasonFile = {
  id: number
  path: string
  duration: number
  /** Where the file's chapters start, in seconds. */
  chapterStarts: readonly number[]
}

/** What a detector found in a season: a marker per file, and the files whose audio could not be read. */
export type SeasonMarkers = { markers: Map<number, Marker>; failed: Set<number> }

/** What each season detector takes. */
export type SeasonDetectorInput = {
  files: readonly SeasonFile[]
  /** The fingerprints kept of the detector's region, by file. */
  kept: ReadonlyMap<number, KeptFingerprint>
  tools: FingerprintTools
  /** Told each fingerprint made, to keep it. */
  onMade: (made: MadeFingerprint) => void
  /** The files whose markers are wanted; the rest only lend their audio. All, when left out. */
  only?: ReadonlySet<number>
}

/** Where in a file to listen: for how long, and where a stretch of a given length starts. */
export type ListenWindow = { seconds: number; startOf: (seconds: number) => number }

type HearProps = {
  file: SeasonFile
  kept: KeptFingerprint | null
  window: ListenWindow
  tools: FingerprintTools
  onMade: (made: MadeFingerprint) => void
}

/**
 * The file's fingerprint over the window: the kept one when it covers the
 * window, else made now and handed to `onMade`. Null when the audio cannot
 * be read.
 */
const hear = async ({
  file,
  kept,
  window,
  tools,
  onMade,
}: HearProps): Promise<Fingerprint | null> => {
  if (kept != null && kept.seconds >= window.seconds - 1) {
    return { start: window.startOf(kept.seconds), points: kept.points }
  }
  const start = window.startOf(window.seconds)
  try {
    const points = await tools.fingerprint({ path: file.path, start, seconds: window.seconds })
    onMade({ id: file.id, seconds: window.seconds, points })
    return { start, points }
  } catch {
    return null
  }
}

type HearSeasonProps = Omit<SeasonDetectorInput, 'only'> & {
  windowOf: (file: SeasonFile) => ListenWindow
}

/** The season heard: each file's fingerprint over its window, and the files that could not be read. */
export type HeardSeason = { heard: SeasonEpisode[]; failed: Set<number> }

/** Each file heard in turn, one ffmpeg at a time, so a season never floods a NAS share with reads. */
export const hearSeason = ({
  files,
  kept,
  tools,
  onMade,
  windowOf,
}: HearSeasonProps): Promise<HeardSeason> =>
  files.reduce<Promise<HeardSeason>>(
    async (previous, file) => {
      const done = await previous
      const heard = await hear({
        file,
        kept: kept.get(file.id) ?? null,
        window: windowOf(file),
        tools,
        onMade,
      })
      return heard == null
        ? { heard: done.heard, failed: new Set([...done.failed, file.id]) }
        : { heard: [...done.heard, { id: file.id, heard }], failed: done.failed }
    },
    Promise.resolve({ heard: [], failed: new Set() }),
  )

/** A run matched in a file, to place as a marker. */
export type PlacedRun = { run: FoundRun; file: SeasonFile }

type MarkersOfProps = {
  files: readonly SeasonFile[]
  found: ReadonlyMap<number, FoundRun>
  only?: ReadonlySet<number>
  markerOf: (placed: PlacedRun) => Marker
}

/** Each wanted file's run as a marker. */
export const markersOf = ({ files, found, only, markerOf }: MarkersOfProps): Map<number, Marker> =>
  files.reduce((done, file) => {
    const run = found.get(file.id)
    if (run == null || (only !== undefined && !only.has(file.id))) return done
    return done.set(file.id, markerOf({ run, file }))
  }, new Map<number, Marker>())
