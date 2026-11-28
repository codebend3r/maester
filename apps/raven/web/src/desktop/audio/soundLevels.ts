import { EQ_BANDS, type SoundMeasure } from '@raven/core'
import type { SoundLevels } from '@raven/ui/headless'

/** The loudness a bar spans, in dBFS: silent at the floor, full at the ceiling. */
export const BAR_RANGE_DB = { floor: -60, ceiling: 0 } as const

/** The frequencies the bars stand for, low to high: the equalizer's own span. */
const SPECTRUM_HZ = {
  low: EQ_BANDS[0],
  high: EQ_BANDS[EQ_BANDS.length - 1] ?? EQ_BANDS[0],
} as const

/** Where a measure with no centroid leans: the middle, so every bar weighs the same. */
const NO_LEAN = 0.5

/** How much of a bar's height its distance from the centroid can take away. */
const LEAN_SHARE = 0.35

type UnitProps = { value: number }

const unit = ({ value }: UnitProps): number => Math.min(1, Math.max(0, value))

/** A level in dBFS as a bar's share of its height. */
const shareOf = (decibels: number): number =>
  unit({ value: (decibels - BAR_RANGE_DB.floor) / (BAR_RANGE_DB.ceiling - BAR_RANGE_DB.floor) })

/** Where the centroid sits on the bars' log frequency axis, from 0 (lowest) to 1 (highest). */
const leanOf = (centroid: number | null): number => {
  if (centroid === null || centroid <= 0) return NO_LEAN
  return unit({
    value: Math.log(centroid / SPECTRUM_HZ.low) / Math.log(SPECTRUM_HZ.high / SPECTRUM_HZ.low),
  })
}

/**
 * Each bar's own weight, from 0.7 to 1, repeating across the bars: fixed for its
 * place, so neighbours differ and each bar keeps its character from one frame to the next.
 */
const BAR_WEIGHTS = [0.76, 0.95, 0.7, 0.88, 1, 0.81, 0.73, 0.92] as const

const weightOf = (index: number): number => BAR_WEIGHTS[index % BAR_WEIGHTS.length] ?? 1

type BarLevelsProps = { measure: SoundMeasure | null; count: number }

/**
 * The bars for what mpv measured, low to high. mpv gives one loudness, not bands, so each bar
 * is spread from it: the low bars follow the RMS (the body), the high ones the peak (the
 * attack), each is weighted by its fixed weight, and the bars nearest the spectral centroid
 * stand tallest, so bright music lifts the right and a bass line the left. Silent before
 * anything was measured.
 */
export const barLevelsOf = ({ measure, count }: BarLevelsProps): number[] => {
  const bars = Array.from({ length: Math.max(0, Math.floor(count)) }, (_, index) => index)
  if (measure === null) return bars.map(() => 0)
  const body = shareOf(measure.rms)
  const attack = shareOf(measure.peak)
  const lean = leanOf(measure.centroid)
  return bars.map((index) => {
    const place = (index + 0.5) / bars.length
    const loudness = body + (attack - body) * place
    const nearness = 1 - unit({ value: Math.abs(place - lean) * 2 })
    return unit({ value: loudness * weightOf(index) * (1 - LEAN_SHARE + LEAN_SHARE * nearness) })
  })
}

type SoundReader = {
  /** What `useSoundMeter` reads: the bars for the newest measure. */
  levels: SoundLevels
  /** Keeps the newest measure main sent. */
  take: (measure: SoundMeasure) => void
}

/** A reader over the newest measure main sent, which the bars read on every frame. */
export const createSoundReader = (): SoundReader => {
  let latest: SoundMeasure | null = null
  return {
    levels: ({ count }) => barLevelsOf({ measure: latest, count }),
    take: (measure) => {
      latest = measure
    },
  }
}
