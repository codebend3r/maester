import { describe, expect, it } from 'vitest'
import { albumGainOf, ebur128Args, parseEbur128, trackGainOf } from '@/music/loudness'

/** The tail of ffmpeg 9's stderr for `ebur128=peak=true`: a last frame line, then the summary. */
const SUMMARY = `[Parsed_ebur128_0 @ 0x7ace838900] t: 1.999977   TARGET:-23 LUFS    M: -21.8 S:-120.7     I: -21.8 LUFS       LRA:   0.0 LU  FTPK: -18.1 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x7ace838900] Summary:

  Integrated loudness:
    I:         -14.2 LUFS
    Threshold: -24.2 LUFS

  Loudness range:
    LRA:         5.1 LU
    Threshold:  -34.3 LUFS
    LRA low:    -18.6 LUFS
    LRA high:   -13.5 LUFS

  True peak:
    Peak:       -0.8 dBFS
[out#0/null @ 0x7ace838180] video:0KiB audio:172KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown
size=N/A time=00:00:02.00 bitrate=N/A speed= 246x elapsed=0:00:00.00
`

describe('parseEbur128', () => {
  it('reads the integrated loudness and the true peak from the summary, not a frame line', () => {
    expect(parseEbur128(SUMMARY)).toEqual({ integrated: -14.2, truePeak: -0.8 })
  })

  it('is null with no summary, or a summary of silence', () => {
    expect(parseEbur128('[in#0 @ 0x1] Error opening input: Invalid data')).toBeNull()
    expect(parseEbur128(SUMMARY.replace('-0.8 dBFS', '-inf dBFS'))).toBeNull()
  })
})

describe('trackGainOf', () => {
  it('brings the track to -18 LUFS and turns the true peak into a ratio', () => {
    const { gain, peak } = trackGainOf({ integrated: -14.2, truePeak: -0.8 })
    expect(gain).toBeCloseTo(-3.8, 6)
    expect(peak).toBeCloseTo(0.912, 3)
  })
})

describe('albumGainOf', () => {
  it('averages the tracks’ energy by duration before bringing it to -18 LUFS', () => {
    const gain = albumGainOf([
      { integrated: -10, duration: 60 },
      { integrated: -20, duration: 60 },
    ])
    expect(gain).toBeCloseTo(-18 - -12.596, 3)
  })

  it('weighs a longer track more', () => {
    expect(
      albumGainOf([
        { integrated: -10, duration: 180 },
        { integrated: -20, duration: 60 },
      ]),
    ).toBeLessThan(
      albumGainOf([
        { integrated: -10, duration: 60 },
        { integrated: -20, duration: 60 },
      ]),
    )
  })
})

describe('ebur128Args', () => {
  it('measures the first audio track with true peaks and writes nothing', () => {
    expect(ebur128Args('/music/a.flac')).toEqual([
      '-hide_banner',
      '-nostdin',
      '-nostats',
      '-i',
      '/music/a.flac',
      '-map',
      '0:a:0',
      '-filter:a',
      'ebur128=peak=true',
      '-f',
      'null',
      '-',
    ])
  })
})
