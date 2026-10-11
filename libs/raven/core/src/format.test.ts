import { describe, expect, it } from 'vitest'
import { formatBitrate, formatBytes, formatChannels, formatDuration, formatRuntime } from '@/format'

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
