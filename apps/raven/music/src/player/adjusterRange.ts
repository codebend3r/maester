/** Hundredths: how a range set in fractions is read out, since Android's range info is whole. */
const PERCENT = 100

type AdjusterRangeOfProps = { value: number; max: number; step: number }

/**
 * An adjustable's range as a screen reader takes it, in whole numbers: as it is when it moves
 * in whole steps (the scrubber's seconds), in hundredths when it moves in fractions (the
 * volume from 0 to 1), which would otherwise round to 0 or 1.
 */
export const adjusterRangeOf = ({ value, max, step }: AdjusterRangeOfProps) => {
  const scale = Number.isInteger(step) ? 1 : PERCENT
  return { min: 0, max: Math.round(max * scale), now: Math.round(value * scale) }
}
