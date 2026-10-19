import { describe, expect, it } from 'vitest'
import {
  DEMUX_TIME_BASES,
  SEGMENT_CLOCKS,
  hlsDialectOf,
  toolMismatch,
} from '@/ffmpeg/ffmpegVersion'

describe('toolMismatch', () => {
  it('names no mismatch for one build, or when a tool says nothing', () => {
    expect(
      toolMismatch({
        ffmpeg: 'ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023',
        ffprobe: 'ffprobe version 6.1.1-3ubuntu5 Copyright (c) 2000-2023',
      }),
    ).toBeNull()
    expect(toolMismatch({ ffmpeg: 'ffmpeg version 9.0.2', ffprobe: null })).toBeNull()
  })
})

describe('hlsDialectOf', () => {
  const timeBaseOf = (version: string | null) => hlsDialectOf(version).timeBase
  const segmentClockOf = (version: string | null) => hlsDialectOf(version).segmentClock

  it('names the time base demux from FFmpeg 6.1, and -1 before', () => {
    expect(
      [
        'ffmpeg version 5.1.9-0+deb12u1 Copyright (c) 2000-2026',
        'ffmpeg version 6.0.1 Copyright (c) 2000-2023',
        'ffmpeg version n6.0 Copyright (c) 2000-2023',
        'ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023',
        'ffmpeg version 9.0.2 Copyright (c) 2000-2026',
        'ffmpeg version N-112345-gabcdef Copyright',
        null,
      ].map(timeBaseOf),
    ).toEqual([
      DEMUX_TIME_BASES.numbered,
      DEMUX_TIME_BASES.numbered,
      DEMUX_TIME_BASES.numbered,
      DEMUX_TIME_BASES.named,
      DEMUX_TIME_BASES.named,
      DEMUX_TIME_BASES.named,
      DEMUX_TIME_BASES.named,
    ])
  })

  it('reads segment times from the run’s start from FFmpeg 6.0 on', () => {
    expect(
      [
        'ffmpeg version 6.0.1 Copyright (c) 2000-2023',
        'ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023',
        'ffmpeg version 9.0.2 Copyright (c) 2000-2026',
        'ffmpeg version 7.1.1-Jellyfin Copyright',
      ].map(segmentClockOf),
    ).toEqual([SEGMENT_CLOCKS.run, SEGMENT_CLOCKS.run, SEGMENT_CLOCKS.run, SEGMENT_CLOCKS.run])
  })

  it('reads them as output timestamps before 6.0', () => {
    expect(segmentClockOf('ffmpeg version 5.1.9-0+deb12u1 Copyright (c) 2000-2026')).toBe(
      SEGMENT_CLOCKS.output,
    )
    expect(segmentClockOf('ffmpeg version n4.4.2 Copyright')).toBe(SEGMENT_CLOCKS.output)
  })

  it('takes a build with no release number, or no ffmpeg, as new', () => {
    expect(hlsDialectOf('ffmpeg version N-118000-gabcdef Copyright')).toEqual({
      segmentClock: SEGMENT_CLOCKS.run,
      timeBase: DEMUX_TIME_BASES.named,
    })
    expect(hlsDialectOf(null)).toEqual({
      segmentClock: SEGMENT_CLOCKS.run,
      timeBase: DEMUX_TIME_BASES.named,
    })
  })
})
