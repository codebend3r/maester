import { describe, expect, it } from 'vitest'
import { remuxPlan, runSegmentTimes, segmentDurations, transcodePlan } from '@/hls/segmentPlan'

const SPIKE_PLAN = {
  boundaries: [0, 15.5, 22.125, 31.458, 41.458, 51.458, 59.542, 69.542, 80.042],
  duration: 89.959,
}

describe('remuxPlan', () => {
  it('starts each segment at the first keyframe six seconds past the last start', () => {
    const plan = remuxPlan({ keyframes: [0, 0.5, 9.5, 10, 13, 16.2, 30], duration: 31 })

    expect(plan).toEqual({ boundaries: [0, 9.5, 16.2, 30], duration: 31 })
    expect(plan && segmentDurations(plan)).toEqual([9.5, 6.7, 13.8, 1])
  })

  it('starts segment 0 at the first keyframe', () => {
    const plan = remuxPlan({ keyframes: [0.041, 6.5, 12.9], duration: 15 })

    expect(plan?.boundaries).toEqual([0.041, 6.5, 12.9])
    expect(plan && segmentDurations(plan)).toEqual([6.459, 6.4, 2.1])
  })

  it('takes a keyframe exactly six seconds on', () => {
    const plan = remuxPlan({ keyframes: [0, 3, 6, 12], duration: 14 })

    expect(plan?.boundaries).toEqual([0, 6, 12])
  })

  it('keeps millisecond sums exact', () => {
    const plan = remuxPlan({ keyframes: [0, 6.001, 12.002, 18.003], duration: 20.004 })

    expect(plan && segmentDurations(plan)).toEqual([6.001, 6.001, 6.001, 2.001])
  })

  it('answers null when two boundaries lie more than twenty seconds apart', () => {
    expect(remuxPlan({ keyframes: [0, 5, 26], duration: 30 })).toBeNull()
  })

  it('answers null when the last boundary lies more than twenty seconds from the end', () => {
    expect(remuxPlan({ keyframes: [0, 6, 12], duration: 40 })).toBeNull()
  })

  it('accepts a gap of exactly twenty seconds', () => {
    expect(remuxPlan({ keyframes: [0, 20], duration: 40 })?.boundaries).toEqual([0, 20])
  })

  it('answers null with no keyframes', () => {
    expect(remuxPlan({ keyframes: [], duration: 10 })).toBeNull()
  })

  it('ignores keyframes at or past the duration', () => {
    const plan = remuxPlan({ keyframes: [0, 7, 10, 11], duration: 10 })

    expect(plan).toEqual({ boundaries: [0, 7], duration: 10 })
  })
})

describe('transcodePlan', () => {
  it('cuts every six seconds and ends at the duration', () => {
    const plan = transcodePlan({ start: 0, duration: 13 })

    expect(plan).toEqual({ boundaries: [0, 6, 12], duration: 13 })
    expect(segmentDurations(plan)).toEqual([6, 6, 1])
  })

  it('has no short segment when the duration divides evenly', () => {
    const plan = transcodePlan({ start: 0, duration: 12 })

    expect(plan.boundaries).toEqual([0, 6])
    expect(segmentDurations(plan)).toEqual([6, 6])
  })

  it("starts at the file's own clock, where a recording's does not begin at zero", () => {
    const plan = transcodePlan({ start: 2.5, duration: 16 })

    expect(plan).toEqual({ boundaries: [2.5, 8.5, 14.5], duration: 16 })
    expect(segmentDurations(plan)).toEqual([6, 6, 1.5])
  })

  it('keeps one segment for a duration of nothing', () => {
    expect(transcodePlan({ start: 0, duration: 0 }).boundaries).toEqual([0])
  })
})

describe('segmentDurations', () => {
  it('measures the spike plan to the millisecond', () => {
    expect(segmentDurations(SPIKE_PLAN)).toEqual([
      15.5, 6.625, 9.333, 10, 10, 8.084, 10, 10.5, 9.917,
    ])
  })
})

describe('runSegmentTimes', () => {
  it('lists the boundaries after the run start, relative to it', () => {
    expect(runSegmentTimes({ plan: SPIKE_PLAN, from: 4 })).toEqual([10, 18.084, 28.084, 38.584])
  })

  it('lists every boundary after the first for a run from zero', () => {
    expect(runSegmentTimes({ plan: SPIKE_PLAN, from: 0 })).toEqual([
      15.5, 22.125, 31.458, 41.458, 51.458, 59.542, 69.542, 80.042,
    ])
  })

  it('lists nothing from the last segment', () => {
    expect(runSegmentTimes({ plan: SPIKE_PLAN, from: 8 })).toEqual([])
  })

  it('lists nothing past the last segment', () => {
    expect(runSegmentTimes({ plan: SPIKE_PLAN, from: 20 })).toEqual([])
  })
})
