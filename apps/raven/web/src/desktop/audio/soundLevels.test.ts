import { describe, expect, it } from 'bun:test'
import { BAR_RANGE_DB, barLevelsOf, createSoundReader } from '@/desktop/audio/soundLevels'

const LOUD = { rms: -12, peak: -3, centroid: 1500 } as const
const QUIET = { rms: -45, peak: -36, centroid: 1500 } as const

const sum = (levels: readonly number[]) => levels.reduce((total, level) => total + level, 0)

describe('barLevelsOf', () => {
  it('gives one level a bar, each from 0 to 1, and all silent before a measure', () => {
    const levels = barLevelsOf({ measure: LOUD, count: 5 })
    expect(levels).toHaveLength(5)
    levels.forEach((level) => {
      expect(level).toBeGreaterThan(0)
      expect(level).toBeLessThanOrEqual(1)
    })
    expect(barLevelsOf({ measure: null, count: 4 })).toEqual([0, 0, 0, 0])
    expect(barLevelsOf({ measure: LOUD, count: 0 })).toEqual([])
  })

  it('rises and falls with the music, every bar together', () => {
    const loud = barLevelsOf({ measure: LOUD, count: 5 })
    const quiet = barLevelsOf({ measure: QUIET, count: 5 })
    loud.forEach((level, index) => expect(level).toBeGreaterThan(quiet[index] ?? 1))
  })

  it('is silent at the floor and fixed for the same measure, each bar keeping its weight', () => {
    const floor = { rms: BAR_RANGE_DB.floor, peak: BAR_RANGE_DB.floor, centroid: null }
    expect(barLevelsOf({ measure: floor, count: 3 })).toEqual([0, 0, 0])
    expect(barLevelsOf({ measure: LOUD, count: 5 })).toEqual(
      barLevelsOf({ measure: LOUD, count: 5 }),
    )
    expect(new Set(barLevelsOf({ measure: LOUD, count: 5 })).size).toBe(5)
  })

  it('stands the bars nearest the centroid tallest', () => {
    const even = { rms: -12, peak: -12 }
    const bass = barLevelsOf({ measure: { ...even, centroid: 40 }, count: 8 })
    const bright = barLevelsOf({ measure: { ...even, centroid: 12_000 }, count: 8 })
    expect(sum(bass.slice(0, 4))).toBeGreaterThan(sum(bright.slice(0, 4)))
    expect(sum(bright.slice(4))).toBeGreaterThan(sum(bass.slice(4)))
  })

  it('lets the peak lift the high bars over the low ones', () => {
    const punchy = barLevelsOf({ measure: { rms: -40, peak: 0, centroid: null }, count: 8 })
    const flat = barLevelsOf({ measure: { rms: -40, peak: -40, centroid: null }, count: 8 })
    expect(sum(punchy.slice(4)) - sum(flat.slice(4))).toBeGreaterThan(
      sum(punchy.slice(0, 4)) - sum(flat.slice(0, 4)),
    )
  })
})

describe('createSoundReader', () => {
  it('reads the bars for the newest measure it was handed', () => {
    const reader = createSoundReader()
    expect(reader.levels({ count: 3 })).toEqual([0, 0, 0])
    reader.take(QUIET)
    reader.take(LOUD)
    expect(reader.levels({ count: 3 })).toEqual(barLevelsOf({ measure: LOUD, count: 3 }))
  })
})
