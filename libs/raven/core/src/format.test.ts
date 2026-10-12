import { describe, expect, it } from 'vitest'
import {
  formatBitrate,
  formatBytes,
  formatChannels,
  formatDuration,
  formatRuntime,
  timeAgo,
} from '@/format'

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [245, '4:05'],
    [5525, '1:32:05'],
    [null, '0:00'],
    [Number.NaN, '0:00'],
    [-3, '0:00'],
  ])('formats %s as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected)
  })
})

describe('formatRuntime', () => {
  it('reads like a runtime', () => {
    expect(formatRuntime(5812.7)).toBe('1h 37m')
    expect(formatRuntime(2520)).toBe('42m')
    expect(formatRuntime(12)).toBe('12s')
    expect(formatRuntime(null)).toBeNull()
  })
})

describe('formatBytes', () => {
  it('uses decimal units', () => {
    expect(formatBytes(4_924_174_846)).toBe('4.9 GB')
    expect(formatBytes(512_000)).toBe('512 KB')
    expect(formatBytes(0)).toBe('0 B')
  })
})

describe('formatBitrate', () => {
  it('reads in megabits, or kilobits under one', () => {
    expect(formatBitrate(2_215_000)).toBe('2.2 Mb/s')
    expect(formatBitrate(48_712_000)).toBe('48.7 Mb/s')
    expect(formatBitrate(640_000)).toBe('640 kb/s')
  })

  it('has nothing to say before the file is probed', () => {
    expect(formatBitrate(null)).toBeNull()
  })
})

describe('formatChannels', () => {
  it('names the common layouts', () => {
    expect(formatChannels(2)).toBe('Stereo')
    expect(formatChannels(6)).toBe('5.1')
    expect(formatChannels(3)).toBe('3 ch')
    expect(formatChannels(null)).toBeNull()
  })
})

describe('timeAgo', () => {
  const now = new Date('2026-10-11T12:00:00.000Z')

  it('says how long ago in the largest whole unit, narrow by default', () => {
    expect(timeAgo({ at: '2026-10-11T06:00:00.000Z', now })).toMatch(/6\s?h/)
    expect(timeAgo({ at: '2026-10-08T12:00:00.000Z', now })).toMatch(/3\s?d/)
    expect(timeAgo({ at: '2024-10-11T12:00:00.000Z', now })).toMatch(/2\s?y/)
    expect(timeAgo({ at: '2026-10-11T11:59:50.000Z', now })).toBe('just now')
  })

  it('spells it out in the long style, naming yesterday', () => {
    expect(timeAgo({ at: '2026-10-08T12:00:00.000Z', now, style: 'long' })).toBe('3 days ago')
    expect(timeAgo({ at: '2026-10-10T12:00:00.000Z', now, style: 'long' })).toBe('yesterday')
  })
})
