/** The speed a download reports: a share of each new reading, the rest from the readings before it. */
const SMOOTHING = 0.3

/** Readings closer than this are the same event heard twice; main's progress comes four times a second. */
export const MIN_READING_MS = 200

/** A download that has sent nothing for this long is not moving, whatever its last reading said. */
export const STALE_MS = 3000

export type SpeedSample = {
  bytes: number
  at: number
  /** Bytes a second, smoothed; null until a second reading gives one. */
  bytesPerSecond: number | null
}

type NextSampleProps = {
  previous: SpeedSample | undefined
  bytes: number
  now: number
}

/** The sample after a reading of `bytes` at `now`: smoothed, and started over if the file did. */
export const nextSample = ({ previous, bytes, now }: NextSampleProps): SpeedSample => {
  if (previous === undefined || bytes < previous.bytes) {
    return { bytes, at: now, bytesPerSecond: null }
  }
  const elapsed = now - previous.at
  if (elapsed < MIN_READING_MS) return previous
  const instant = ((bytes - previous.bytes) / elapsed) * 1000
  const bytesPerSecond =
    previous.bytesPerSecond === null
      ? instant
      : previous.bytesPerSecond + (instant - previous.bytesPerSecond) * SMOOTHING
  return { bytes, at: now, bytesPerSecond }
}

type FreshSpeedProps = { sample: SpeedSample | undefined; now: number }

/** The speed to show: the sample's, unless it has gone quiet or has none yet. */
export const freshSpeed = ({ sample, now }: FreshSpeedProps): number | null => {
  if (sample === undefined || now - sample.at > STALE_MS) return null
  return sample.bytesPerSecond
}
