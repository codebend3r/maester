import { POINT_SECONDS } from '@/markers/fingerprintMatch'

/** How many fingerprint points `seconds` of audio makes. */
export const pointsFor = (seconds: number): number => Math.round(seconds / POINT_SECONDS)

type NoiseProps = { seed: number; count: number }

/** `count` points of audio nothing else shares: a seeded xorshift, so a test is the same every run. */
export const noise = ({ seed, count }: NoiseProps): number[] =>
  Array.from({ length: count }).reduce<{ state: number; points: number[] }>(
    ({ state, points }) => {
      const a = (state ^ (state << 13)) >>> 0
      const b = (a ^ (a >>> 17)) >>> 0
      const next = (b ^ (b << 5)) >>> 0
      return { state: next, points: [...points, next] }
    },
    { state: (seed * 2654435761) >>> 0 || 1, points: [] },
  ).points

type WithThemeProps = {
  seed: number
  /** The file's length. */
  seconds: number
  theme: readonly number[]
  /** Where the theme starts, in seconds. */
  at: number
}

/** A file's fingerprint: its own sound throughout, with `theme` laid over it from `at`. */
export const withTheme = ({ seed, seconds, theme, at }: WithThemeProps): number[] => {
  const own = noise({ seed, count: pointsFor(seconds) })
  const from = pointsFor(at)
  return own.map((point, index) => theme[index - from] ?? point)
}
