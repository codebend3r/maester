import { HLS_MAX_KEYFRAME_GAP_SECONDS, HLS_SEGMENT_SECONDS } from '@raven/core'

/**
 * `boundaries[k]` is segment `k`'s start in seconds and the last segment
 * ends at `duration`, both on the file's own clock.
 */
export type SegmentPlan = { boundaries: readonly number[]; duration: number }

const SECOND_MS = 1000
const SEGMENT_MS = HLS_SEGMENT_SECONDS * SECOND_MS
const MAX_GAP_MS = HLS_MAX_KEYFRAME_GAP_SECONDS * SECOND_MS

// Plans are computed in whole milliseconds so sums and differences of
// three-decimal times never drift. A stored keyframe is already truncated to
// three decimals, so this only undoes the float error of reading it.
const toMs = (seconds: number): number => Math.round(seconds * SECOND_MS)
const toSeconds = (ms: number): number => ms / SECOND_MS

const fromMs = ({
  boundariesMs,
  durationMs,
}: {
  boundariesMs: number[]
  durationMs: number
}): SegmentPlan => ({
  boundaries: boundariesMs.map(toSeconds),
  duration: toSeconds(durationMs),
})

const spansMs = (plan: SegmentPlan): number[] => {
  const starts = plan.boundaries.map(toMs)
  return starts.map((start, index) => (starts[index + 1] ?? toMs(plan.duration)) - start)
}

/**
 * Cuts a remux's segments at its keyframes: the first at the first keyframe,
 * each next at the first keyframe six seconds or more after the last start.
 * Null when two boundaries, or the last one and the end, lie further apart
 * than a remux can bear; the caller answers 409.
 */
export const remuxPlan = ({
  keyframes,
  duration,
}: {
  keyframes: readonly number[]
  duration: number
}): SegmentPlan | null => {
  const durationMs = toMs(duration)
  const inside = keyframes.map(toMs).filter((keyframe) => keyframe < durationMs)
  const [first] = inside
  if (first === undefined) return null

  const boundariesMs = inside.reduce<number[]>(
    (boundaries, keyframe) => {
      const last = boundaries[boundaries.length - 1] ?? first
      return keyframe >= last + SEGMENT_MS ? [...boundaries, keyframe] : boundaries
    },
    [first],
  )

  const isTooSparse = boundariesMs.some(
    (start, index) => (boundariesMs[index + 1] ?? durationMs) - start > MAX_GAP_MS,
  )
  return isTooSparse ? null : fromMs({ boundariesMs, durationMs })
}

/**
 * Cuts a transcode every six seconds from `start`, where the file's own
 * clock begins: the encoder is told to put a keyframe at each.
 */
export const transcodePlan = ({
  start,
  duration,
}: {
  start: number
  duration: number
}): SegmentPlan => {
  const startMs = toMs(start)
  const durationMs = toMs(duration)
  const count = Math.max(1, Math.ceil((durationMs - startMs) / SEGMENT_MS))
  return fromMs({
    boundariesMs: Array.from({ length: count }, (_, index) => startMs + index * SEGMENT_MS),
    durationMs,
  })
}

export const segmentDurations = (plan: SegmentPlan): number[] => spansMs(plan).map(toSeconds)

/**
 * The boundaries after segment `from`, relative to it, for ffmpeg's
 * `-segment_times`: the segment muxer reads them as offsets from the run's
 * first packet, not from the file's start.
 */
export const runSegmentTimes = ({ plan, from }: { plan: SegmentPlan; from: number }): number[] => {
  const start = toMs(plan.boundaries[from] ?? 0)
  return plan.boundaries.slice(from + 1).map((boundary) => toSeconds(toMs(boundary) - start))
}
