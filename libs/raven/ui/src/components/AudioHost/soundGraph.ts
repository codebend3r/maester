import { EQ_BANDS, type EqGains } from '@raven/core'
import type { SoundLevels } from '@/stores/soundMeter'

/** Each band's filter: a peak about an octave wide. */
export const EQ_FILTER = { type: 'peaking', q: 1.41 } as const satisfies {
  type: BiquadFilterType
  q: number
}

/**
 * How the meter listens: a 2048 point transform (about 23 Hz a bin at 48 kHz, so the lowest
 * band still holds a bin or two), smoothed over a few frames so the bars glide rather than
 * flicker, and split from `lowestHz` to `highestHz`, where nearly all of music's energy is.
 */
export const SOUND_ANALYSER = {
  fftSize: 2048,
  smoothing: 0.8,
  lowestHz: 40,
  highestHz: 16000,
} as const

/** The loudest a byte of the analyser's frequency data reads. */
const BYTE_MAX = 255

/** The part of an `AudioParam` the graph moves. */
type SoundParam = {
  value: number
  setValueAtTime(value: number, startTime: number): unknown
  linearRampToValueAtTime(value: number, endTime: number): unknown
  cancelScheduledValues(cancelTime: number): unknown
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown
}

/** How fast a band glides to a new gain, so a slider dragged across it does not click. */
const EQ_SMOOTHING_SECONDS = 0.02

type SoundNode = { connect(destination: SoundNode): unknown }

type SoundGain = SoundNode & { gain: SoundParam }

type SoundFilter = SoundNode & {
  type: BiquadFilterType
  frequency: SoundParam
  Q: SoundParam
  gain: SoundParam
}

type SoundAnalyser = SoundNode & {
  fftSize: number
  smoothingTimeConstant: number
  readonly frequencyBinCount: number
  getByteFrequencyData(array: Uint8Array<ArrayBuffer>): void
}

/** The part of an `AudioContext` the graph is built from, so a test can hand it a fake. */
type SoundContext = {
  readonly currentTime: number
  readonly sampleRate: number
  readonly destination: SoundNode
  createMediaElementSource(element: HTMLMediaElement): SoundNode
  createGain(): SoundGain
  createBiquadFilter(): SoundFilter
  createAnalyser(): SoundAnalyser
}

/** A band's bins in the analyser's data, `to` left out. */
type BinRange = { from: number; to: number }

type BinRangesProps = {
  count: number
  /** How wide one bin is, in Hz. */
  binHz: number
  /** How many bins the data holds. */
  bins: number
}

/** Splits the spectrum into `count` bands spaced evenly in pitch, each at least one bin wide. */
const binRangesOf = ({ count, binHz, bins }: BinRangesProps): readonly BinRange[] => {
  const ratio = SOUND_ANALYSER.highestHz / SOUND_ANALYSER.lowestHz
  const edge = (band: number): number => SOUND_ANALYSER.lowestHz * ratio ** (band / count)
  return Array.from({ length: count }, (_, band) => {
    const from = Math.min(bins - 1, Math.floor(edge(band) / binHz))
    const to = Math.min(bins, Math.max(from + 1, Math.ceil(edge(band + 1) / binHz)))
    return { from, to }
  })
}

type MeterProps = { context: SoundContext; analyser: SoundAnalyser }

/** Reads the analyser's spectrum as `count` levels from 0 to 1, each its band's mean. */
const meterOf = ({ context, analyser }: MeterProps): SoundLevels => {
  // One buffer the reader fills on every frame, rather than a new one each time.
  const data = new Uint8Array(analyser.frequencyBinCount)
  const binHz = context.sampleRate / analyser.fftSize
  // The bands for each bar count asked for, split once rather than on every frame.
  const ranges = new Map<number, readonly BinRange[]>()
  const rangesOf = (count: number): readonly BinRange[] => {
    const known = ranges.get(count)
    if (known !== undefined) return known
    const split = binRangesOf({ count, binHz, bins: data.length })
    ranges.set(count, split)
    return split
  }
  return ({ count }) => {
    analyser.getByteFrequencyData(data)
    return rangesOf(count).map(({ from, to }) => {
      const band = data.subarray(from, to)
      return band.reduce((sum, value) => sum + value, 0) / band.length / BYTE_MAX
    })
  }
}

type CrossfadeProps = {
  from: HTMLMediaElement
  to: HTMLMediaElement
  /** How long the fade runs; 0 moves the sound over at once. */
  seconds: number
}

export type SoundGraph = {
  /** Turns each band to its gain in dB, from 32 Hz up. */
  setEq: (gains: EqGains) => void
  /** Fades `from` out and `to` in, linearly, over `seconds`. */
  crossfade: (props: CrossfadeProps) => void
  /** What the listener hears now, after the equalizer, band by band. */
  levels: SoundLevels
}

type SoundGraphProps = {
  context: SoundContext
  /** The elements whose sound goes through the graph; a browser routes an element only once. */
  elements: readonly HTMLMediaElement[]
}

/**
 * The web's sound path: each element through a gain of its own, which a
 * crossfade moves, then through the equalizer's ten bands, then through the
 * analyser the equalizer bars read, to the speakers. Flat bands pass the
 * sound through untouched, and the analyser passes it on as it hears it.
 */
export const soundGraph = ({ context, elements }: SoundGraphProps): SoundGraph => {
  const analyser = context.createAnalyser()
  analyser.fftSize = SOUND_ANALYSER.fftSize
  analyser.smoothingTimeConstant = SOUND_ANALYSER.smoothing
  analyser.connect(context.destination)
  const filters = EQ_BANDS.map((frequency) => {
    const filter = context.createBiquadFilter()
    filter.type = EQ_FILTER.type
    filter.frequency.value = frequency
    filter.Q.value = EQ_FILTER.q
    filter.gain.value = 0
    return filter
  })
  const input = filters.reduceRight<SoundNode>((next, filter) => {
    filter.connect(next)
    return filter
  }, analyser)
  const faders = new Map(
    elements.map((element) => {
      const fader = context.createGain()
      context.createMediaElementSource(element).connect(fader)
      fader.connect(input)
      return [element, fader] as const
    }),
  )

  type RampProps = { element: HTMLMediaElement; level: number; seconds: number }

  const ramp = ({ element, level, seconds }: RampProps) => {
    const gain = faders.get(element)?.gain
    if (!gain) return
    const now = context.currentTime
    gain.cancelScheduledValues(now)
    if (seconds <= 0) {
      gain.setValueAtTime(level, now)
      return
    }
    gain.setValueAtTime(1 - level, now)
    gain.linearRampToValueAtTime(level, now + seconds)
  }

  return {
    setEq: (gains) =>
      filters.forEach((filter, band) => {
        filter.gain.setTargetAtTime(gains[band] ?? 0, context.currentTime, EQ_SMOOTHING_SECONDS)
      }),
    crossfade: ({ from, to, seconds }) => {
      ramp({ element: from, level: 0, seconds })
      ramp({ element: to, level: 1, seconds })
    },
    levels: meterOf({ context, analyser }),
  }
}
