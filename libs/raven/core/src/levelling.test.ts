import { describe, expect, it } from 'bun:test'
import type { Track } from '@/contract/music'
import { DEFAULT_LEVELLING_MODE, LEVELLING_MODES, levelOf } from '@/levelling'

type GainedProps = Partial<Track['gain']>

const gained = (gain: GainedProps): Pick<Track, 'gain'> => ({
  gain: { track: null, album: null, trackPeak: null, albumPeak: null, ...gain },
})

describe('levelOf', () => {
  it('leaves the volume alone when levelling is off', () => {
    expect(levelOf({ track: gained({ track: -6, album: -6 }), mode: LEVELLING_MODES.off })).toBe(1)
  })

  it('turns an album gain of -6 dB into its factor, which the peak does not limit', () => {
    expect(
      levelOf({ track: gained({ album: -6, albumPeak: 0.5 }), mode: LEVELLING_MODES.album }),
    ).toBeCloseTo(0.501, 3)
  })

  it('never turns the volume up, however quiet the track', () => {
    expect(levelOf({ track: gained({ track: 6, album: 6 }), mode: LEVELLING_MODES.album })).toBe(1)
    expect(levelOf({ track: gained({ track: 6 }), mode: LEVELLING_MODES.track })).toBe(1)
  })

  it('keeps a peak from clipping', () => {
    expect(
      levelOf({ track: gained({ track: -1, trackPeak: 1.6 }), mode: LEVELLING_MODES.track }),
    ).toBeCloseTo(0.625, 6)
  })

  it('takes the track gain and peak in track mode, the album’s when there is one in album mode', () => {
    const track = gained({ track: -3, trackPeak: 0.5, album: -9, albumPeak: 0.9 })
    expect(levelOf({ track, mode: LEVELLING_MODES.track })).toBeCloseTo(10 ** (-3 / 20), 6)
    expect(levelOf({ track, mode: LEVELLING_MODES.album })).toBeCloseTo(10 ** (-9 / 20), 6)
  })

  it('limits an album gain by the track’s own peak when the album has none', () => {
    expect(
      levelOf({
        track: gained({ album: 3, trackPeak: 1.6, albumPeak: null }),
        mode: LEVELLING_MODES.album,
      }),
    ).toBeCloseTo(0.625, 6)
  })

  it('falls back to the track gain without an album gain, and gives 1 with no gain at all', () => {
    expect(
      levelOf({ track: gained({ track: -6, trackPeak: 0.5 }), mode: LEVELLING_MODES.album }),
    ).toBeCloseTo(0.501, 3)
    expect(levelOf({ track: gained({}), mode: LEVELLING_MODES.album })).toBe(1)
    expect(levelOf({ track: gained({}), mode: LEVELLING_MODES.track })).toBe(1)
  })

  it('levels by album unless told otherwise', () => {
    expect(DEFAULT_LEVELLING_MODE).toBe(LEVELLING_MODES.album)
  })
})
