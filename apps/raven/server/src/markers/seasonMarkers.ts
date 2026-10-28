import type { Marker } from '@raven/core'
import { detectSeasonCredits } from '@/markers/creditsDetector'
import type { KeptFingerprint, MadeFingerprint } from '@/markers/fingerprintMatch'
import { detectSeasonIntros } from '@/markers/introDetector'
import { REGIONS, type Region, type SeasonDetectorInput } from '@/markers/seasonListen'

/** Each season detector, and the region of a file it listens to. */
const DETECTORS = [
  { region: REGIONS.head, detect: detectSeasonIntros },
  { region: REGIONS.tail, detect: detectSeasonCredits },
] as const

/** A fingerprint just made, whose it is, and which region of the file it covers. */
export type RegionFingerprint = MadeFingerprint & { region: Region }

/** What a season's analysis found: each file's markers, and the files that could not be read. */
export type FoundMarkers = { markers: Map<number, Marker[]>; failed: Set<number> }

type DetectSeasonMarkersProps = Omit<SeasonDetectorInput, 'kept' | 'onMade'> & {
  /** The fingerprints kept of each region, by file. */
  kept: Record<Region, ReadonlyMap<number, KeptFingerprint>>
  onMade: (made: RegionFingerprint) => void
}

/**
 * A season's intros, then its credits: one detector after the other, so
 * only one ffmpeg reads the share at a time.
 */
export const detectSeasonMarkers = ({
  files,
  kept,
  tools,
  onMade,
  only,
}: DetectSeasonMarkersProps): Promise<FoundMarkers> =>
  DETECTORS.reduce<Promise<FoundMarkers>>(
    async (previous, { region, detect }) => {
      const done = await previous
      const { markers, failed } = await detect({
        ...(only !== undefined && { only }),
        files,
        kept: kept[region],
        tools,
        onMade: (made) => onMade({ ...made, region }),
      })
      return {
        markers: Array.from(markers).reduce(
          (all, [id, marker]) => all.set(id, [...(all.get(id) ?? []), marker]),
          new Map(done.markers),
        ),
        failed: new Set([...done.failed, ...failed]),
      }
    },
    Promise.resolve({ markers: new Map(), failed: new Set() }),
  )
