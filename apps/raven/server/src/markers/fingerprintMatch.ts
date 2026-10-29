/**
 * Raw Chromaprint, as ffmpeg's `chromaprint` muxer writes it with
 * `-fp_format raw`: one 32 bit point per 4096 / 3 samples of mono audio at
 * 11025 Hz, so about eight a second.
 */
export const POINT_SECONDS = 4096 / 3 / 11025

/** Two points this close (differing bits) hear the same sound. */
const MAX_BIT_DIFF = 6

/** A run may skip this many seconds of points that differ, as a sound effect over the theme does. */
const MAX_GAP_S = 3.5

/** How many of the most common exact shifts are tried, each with its neighbours. */
const CANDIDATE_SHIFTS = 12

/** A file's fingerprint over one stretch of it, `start` seconds in. */
export type Fingerprint = { start: number; points: readonly number[] }

/** A kept fingerprint of one region of a file: how many seconds it covers, and its points. */
export type KeptFingerprint = { seconds: number; points: readonly number[] }

/** A fingerprint just made, and whose it is. */
export type MadeFingerprint = KeptFingerprint & { id: number }

/** A stretch of a file to fingerprint, in seconds. */
type Stretch = { path: string; start: number; seconds: number }

/** What detection needs ffmpeg for: `FfmpegService`, or a stand-in in tests. */
export type FingerprintTools = {
  fingerprint: (stretch: Stretch) => Promise<number[]>
}

/** The stretch two files share, in seconds of each. */
export type SharedRun = { start: number; end: number; theirStart: number; theirEnd: number }

const bitsSet = (value: number): number => {
  const a = value - ((value >>> 1) & 0x55555555)
  const b = (a & 0x33333333) + ((a >>> 2) & 0x33333333)
  return (((b + (b >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

type Span = { from: number; to: number }

/** The longest stretch of matching point indices, allowing gaps up to `MAX_GAP_S`. */
const longestSpan = (indices: readonly number[]): Span | null => {
  const gap = MAX_GAP_S / POINT_SECONDS
  const spans = indices.reduce<Span[]>((acc, index) => {
    const last = acc.at(-1)
    if (last && index - last.to <= gap)
      return acc.with(acc.length - 1, { from: last.from, to: index })
    return [...acc, { from: index, to: index }]
  }, [])
  return spans.reduce<Span | null>(
    (best, span) => (best == null || span.to - span.from > best.to - best.from ? span : best),
    null,
  )
}

type CandidateShiftsProps = { own: Fingerprint; theirs: Fingerprint }

/** The shifts (their index minus ours) at which the most points match exactly, each with its neighbours. */
const candidateShifts = ({ own, theirs }: CandidateShiftsProps): number[] => {
  const where = theirs.points.reduce(
    (map, value, index) => map.set(value, [...(map.get(value) ?? []), index]),
    new Map<number, number[]>(),
  )
  const counts = own.points.reduce((map, value, index) => {
    ;(where.get(value) ?? []).forEach((at) => map.set(at - index, (map.get(at - index) ?? 0) + 1))
    return map
  }, new Map<number, number>())
  const common = Array.from(counts.entries())
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, CANDIDATE_SHIFTS)
    .flatMap(([shift]) => [shift - 1, shift, shift + 1])
  return Array.from(new Set(common))
}

type SharedRunProps = {
  own: Fingerprint
  theirs: Fingerprint
  /** The shortest and longest run worth keeping, in seconds. */
  bounds?: { min: number; max: number }
}

/**
 * The longest stretch two fingerprints share, allowing a different offset
 * in each file (a cold open moves the intro): candidate offsets come from
 * points that match exactly, then each is scored point by point on the bits
 * that differ. Null when no run is within `bounds`.
 */
export const sharedRun = ({
  own,
  theirs,
  bounds = { min: 15, max: 130 },
}: SharedRunProps): SharedRun | null =>
  candidateShifts({ own, theirs }).reduce<SharedRun | null>((best, shift) => {
    const matching = own.points.flatMap((value, index) => {
      const other = theirs.points[index + shift]
      return other !== undefined && bitsSet((value ^ other) >>> 0) <= MAX_BIT_DIFF ? [index] : []
    })
    const span = longestSpan(matching)
    if (span == null) return best
    const length = (span.to - span.from) * POINT_SECONDS
    if (length < bounds.min || length > bounds.max) return best
    if (best != null && length <= best.end - best.start) return best
    return {
      start: own.start + span.from * POINT_SECONDS,
      end: own.start + span.to * POINT_SECONDS,
      theirStart: theirs.start + (span.from + shift) * POINT_SECONDS,
      theirEnd: theirs.start + (span.to + shift) * POINT_SECONDS,
    }
  }, null)
