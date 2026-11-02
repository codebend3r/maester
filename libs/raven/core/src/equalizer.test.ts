import { describe, expect, it } from 'bun:test'
import {
  CROSSFADE_SECONDS,
  EQ_BANDS,
  EQ_PRESETS,
  EQ_PRESET_NAMES,
  FLAT_EQUALIZER,
  isCrossfadeSeconds,
  isEqualizer,
  isFlatEq,
} from '@/equalizer'

describe('the equalizer', () => {
  it('has ten bands an octave apart, from 32 Hz', () => {
    expect(EQ_BANDS).toEqual([32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000])
  })

  it('gives every preset a gain for each band', () => {
    expect(Object.values(EQ_PRESETS).every((gains) => gains.length === EQ_BANDS.length)).toBe(true)
    expect(EQ_PRESETS.bassBoost).toEqual([6, 5, 4, 2, 0, 0, 0, 0, 0, 0])
    expect(EQ_PRESETS.trebleBoost).toEqual([0, 0, 0, 0, 0, 0, 2, 4, 5, 6])
    expect(EQ_PRESETS.vocal).toEqual([-2, -2, -1, 0, 2, 4, 4, 2, 0, -1])
    expect(EQ_PRESETS.loudness).toEqual([5, 4, 2, 0, -1, -1, 0, 2, 4, 5])
  })

  it('tells flat gains from any other', () => {
    expect(isFlatEq(FLAT_EQUALIZER.gains)).toBe(true)
    expect(isFlatEq(EQ_PRESETS.vocal)).toBe(false)
  })

  it('takes a preset or hand-set gains, and refuses a wrong count, a gain past 12 dB or an unknown preset', () => {
    expect(isEqualizer(FLAT_EQUALIZER)).toBe(true)
    expect(isEqualizer({ preset: null, gains: [1, 2, 3, 4, 5, 6, 7, 8, 9, -12] })).toBe(true)
    expect(isEqualizer({ preset: EQ_PRESET_NAMES.vocal, gains: [0, 0] })).toBe(false)
    expect(isEqualizer({ preset: null, gains: [13, 0, 0, 0, 0, 0, 0, 0, 0, 0] })).toBe(false)
    expect(isEqualizer({ preset: 'jazz', gains: EQ_PRESETS.flat })).toBe(false)
  })
})

describe('the crossfade', () => {
  it('offers off and 2 to 12 seconds', () => {
    expect(CROSSFADE_SECONDS).toEqual([0, 2, 4, 6, 8, 12])
    expect(isCrossfadeSeconds(6)).toBe(true)
    expect(isCrossfadeSeconds(5)).toBe(false)
  })
})
