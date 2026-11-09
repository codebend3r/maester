import { formatByteRate } from '@/format'

/** The speed a download reports: a share of each new reading, the rest from the readings before it. */
const SMOOTHING = 0.3

/** Readings closer than this are the same moment heard twice. */
export const MIN_READING_MS = 200

/** A download that has sent nothing for this long is not moving, whatever its last reading said. */
export const STALE_MS = 3000

const BITS_PER_BYTE = 8

const SECONDS_PER_MINUTE = 60

const MINUTES_PER_HOUR = 60

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

/**
 * The sample after a reading of `bytes` at `now`: smoothed, and started over if the file did.
 * The desktop's Downloads page and the device app's read their speeds the same way.
 */
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

type TotalSpeedProps = { samples: readonly SpeedSample[]; now: number }

/** Every running download's fresh speed added up; null while none has one. */
export const totalSpeed = ({ samples, now }: TotalSpeedProps): number | null =>
  samples.reduce<number | null>((total, sample) => {
    const speed = freshSpeed({ sample, now })
    return speed === null ? total : (total ?? 0) + speed
  }, null)

type SecondsLeftProps = {
  /** Bytes still to come. */
  remaining: number
  bytesPerSecond: number | null
}

/** How many seconds a download has left at its current speed; null while it is not moving or its size is unknown. */
export const secondsLeftOf = ({ remaining, bytesPerSecond }: SecondsLeftProps): number | null => {
  if (bytesPerSecond === null || bytesPerSecond <= 0 || remaining < 0) return null
  return Math.ceil(remaining / bytesPerSecond)
}

/** "45s", "36m", "1h 12m": a time left, rounded up to the minute past a minute. */
export const durationLabelOf = (seconds: number): string => {
  if (seconds < SECONDS_PER_MINUTE) return `${Math.max(1, seconds)}s`
  const minutes = Math.ceil(seconds / SECONDS_PER_MINUTE)
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m`
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  const rest = minutes % MINUTES_PER_HOUR
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** "12.4 MB/s", "640 KB/s", from bytes a second; null for none. */
export const speedLabelOf = (bytesPerSecond: number | null): string | null =>
  bytesPerSecond === null ? null : formatByteRate(bytesPerSecond * BITS_PER_BYTE)
