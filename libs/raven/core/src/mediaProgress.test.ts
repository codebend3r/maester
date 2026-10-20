import { describe, expect, it } from 'bun:test'
import { progressOf, resumeAtFor, timeLeftOf } from '@/mediaProgress'
import { mediaItem } from '@/test/fixtures'

describe('progressOf', () => {
  it('is the share played, and nothing for a video not started or not yet probed', () => {
    expect(progressOf(mediaItem({ position: 30, duration: 120 }))).toBe(0.25)
    expect(progressOf(mediaItem({ position: 0, duration: 120 }))).toBe(0)
    expect(progressOf(mediaItem({ position: 30, duration: null }))).toBe(0)
    expect(progressOf(mediaItem({ position: 300, duration: 120 }))).toBe(1)
  })
})

describe('timeLeftOf', () => {
  it('says how many minutes are left from where playback stopped', () => {
    expect(timeLeftOf(mediaItem({ position: 600, duration: 4320 }))).toBe('62 min left')
  })

  it('rounds a last few seconds up to a minute', () => {
    expect(timeLeftOf(mediaItem({ position: 100, duration: 110 }))).toBe('1 min left')
  })

  it('says nothing for a video not started, or played to its end', () => {
    expect(timeLeftOf(mediaItem({ position: 0, duration: 4320 }))).toBeNull()
    expect(timeLeftOf(mediaItem({ position: 4320, duration: 4320 }))).toBeNull()
    expect(timeLeftOf(mediaItem({ position: 60, duration: null }))).toBeNull()
  })
})

describe('resumeAtFor', () => {
  it.each([
    { at: 30, position: 50, duration: 1200, expected: 30 },
    { at: 0, position: 50, duration: 1200, expected: 50 },
    { at: 0, position: 1195, duration: 1200, expected: 0 },
    { at: 1195, position: 0, duration: 1200, expected: 0 },
    { at: 0, position: 50, duration: null, expected: 50 },
    { at: 0, position: 0, duration: 1200, expected: 0 },
  ])(
    'starts at $expected for at $at, position $position and duration $duration',
    ({ at, position, duration, expected }) => {
      expect(resumeAtFor({ at, media: mediaItem({ position, duration }) })).toBe(expected)
    },
  )
})
