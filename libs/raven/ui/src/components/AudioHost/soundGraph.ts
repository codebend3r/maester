import { EQ_BANDS, type EqGains } from '@raven/core'

/** Each band's filter: a peak about an octave wide. */
export const EQ_FILTER = { type: 'peaking', q: 1.41 } as const satisfies {
  type: BiquadFilterType
  q: number
}

/** The part of an `AudioParam` the graph moves. */
type SoundParam = {
  value: number
  setValueAtTime(value: number, startTime: number): unknown
  linearRampToValueAtTime(value: number, endTime: number): unknown
  cancelScheduledValues(cancelTime: number): unknown
}

type SoundNode = { connect(destination: SoundNode): unknown }

type SoundGain = SoundNode & { gain: SoundParam }

type SoundFilter = SoundNode & {
  type: BiquadFilterType
  frequency: SoundParam
  Q: SoundParam
  gain: SoundParam
}

/** The part of an `AudioContext` the graph is built from, so a test can hand it a fake. */
type SoundContext = {
  readonly currentTime: number
  readonly destination: SoundNode
  createMediaElementSource(element: HTMLMediaElement): SoundNode
  createGain(): SoundGain
  createBiquadFilter(): SoundFilter
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
}

type SoundGraphProps = {
  context: SoundContext
  /** The elements whose sound goes through the graph; a browser routes an element only once. */
  elements: readonly HTMLMediaElement[]
}

/**
 * The web's sound path: each element through a gain of its own, which a
 * crossfade moves, and then through the equalizer's ten bands to the
 * speakers. Flat bands pass the sound through untouched.
 */
export const soundGraph = ({ context, elements }: SoundGraphProps): SoundGraph => {
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
  }, context.destination)
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
        filter.gain.value = gains[band] ?? 0
      }),
    crossfade: ({ from, to, seconds }) => {
      ramp({ element: from, level: 0, seconds })
      ramp({ element: to, level: 1, seconds })
    },
  }
}
