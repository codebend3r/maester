import { type Guard, type Infer, isNumber, nullable, object, oneOf } from '@/schema'

/** The equalizer's bands, in Hz: ten, an octave apart. */
export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const

/** How far a band turns, in dB, either way. */
export const EQ_GAIN_DB = { min: -12, max: 12 } as const

/** A gain in dB for each of `EQ_BANDS`, from 32 Hz up. */
export type EqGains = readonly number[]

/** The equalizer's presets, by name. */
export const EQ_PRESET_NAMES = {
  flat: 'flat',
  bassBoost: 'bassBoost',
  trebleBoost: 'trebleBoost',
  vocal: 'vocal',
  loudness: 'loudness',
} as const

export type EqPreset = (typeof EQ_PRESET_NAMES)[keyof typeof EQ_PRESET_NAMES]

const isEqPreset = oneOf(Object.values(EQ_PRESET_NAMES))

/** Each preset's gain in dB per band, from 32 Hz up. */
export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bassBoost: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  trebleBoost: [0, 0, 0, 0, 0, 0, 2, 4, 5, 6],
  vocal: [-2, -2, -1, 0, 2, 4, 4, 2, 0, -1],
  loudness: [5, 4, 2, 0, -1, -1, 0, 2, 4, 5],
} as const satisfies Record<EqPreset, EqGains>

/** Ten gains in dB, one per band, each within `EQ_GAIN_DB`. */
export const isEqGains: Guard<EqGains> = (value): value is EqGains =>
  Array.isArray(value) &&
  value.length === EQ_BANDS.length &&
  value.every((gain) => isNumber(gain) && gain >= EQ_GAIN_DB.min && gain <= EQ_GAIN_DB.max)

/** The equalizer as set: the preset it came from, or null once a band was moved by hand, and its gains. */
export const isEqualizer = object({ preset: nullable(isEqPreset), gains: isEqGains })

export type Equalizer = Infer<typeof isEqualizer>

/** The equalizer that changes nothing. */
export const FLAT_EQUALIZER: Equalizer = { preset: EQ_PRESET_NAMES.flat, gains: EQ_PRESETS.flat }

/** Whether `gains` leave every band alone, so there is nothing to equalise. */
export const isFlatEq = (gains: EqGains): boolean => gains.every((gain) => gain === 0)

/** How many seconds two tracks overlap as one fades into the next; 0 is off. */
export const CROSSFADE_SECONDS = [0, 2, 4, 6, 8, 12] as const

export const isCrossfadeSeconds = oneOf(CROSSFADE_SECONDS)

export type CrossfadeSeconds = (typeof CROSSFADE_SECONDS)[number]
