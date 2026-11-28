import { EQ_BANDS, EQ_PRESETS } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { EQ_FILTER, SOUND_ANALYSER, soundGraph } from '@/components/AudioHost/soundGraph'
import { FakeAudioContext } from '@/test/fakeAudioContext'

const twoElements = (): HTMLAudioElement[] => [
  document.createElement('audio'),
  document.createElement('audio'),
]

describe('soundGraph', () => {
  it('makes ten peaking filters at the band frequencies, flat, between each element and the analyser before the speakers', () => {
    const context = new FakeAudioContext()
    const elements = twoElements()
    soundGraph({ context, elements })
    expect(context.filters.map((filter) => filter.frequency.value)).toEqual([...EQ_BANDS])
    expect(context.filters.every((filter) => filter.type === EQ_FILTER.type)).toBe(true)
    expect(context.filters.every((filter) => filter.Q.value === 1.41)).toBe(true)
    expect(context.filters.every((filter) => filter.gain.value === 0)).toBe(true)
    const [analyser] = context.analysers
    expect(context.analysers).toHaveLength(1)
    expect(context.filters.at(-1)?.outputs).toEqual(analyser ? [analyser] : [])
    expect(analyser?.outputs).toEqual([context.destination])
    expect(analyser?.fftSize).toBe(SOUND_ANALYSER.fftSize)
    expect(analyser?.smoothingTimeConstant).toBe(SOUND_ANALYSER.smoothing)
    expect(context.filters[0]?.outputs).toEqual([context.filters[1]])
    expect(context.sources.size).toBe(2)
    elements.forEach((element, index) => {
      const fader = context.gains[index]
      expect(context.sources.get(element)?.outputs).toEqual(fader ? [fader] : [])
      expect(fader?.outputs).toEqual(context.filters.slice(0, 1))
    })
  })

  it("glides each band to a preset's gain", () => {
    const context = new FakeAudioContext()
    const graph = soundGraph({ context, elements: twoElements() })
    graph.setEq(EQ_PRESETS.bassBoost)
    expect(context.filters.map((filter) => filter.gain.targets)).toEqual(
      EQ_PRESETS.bassBoost.map((value) => [{ value, time: 10, timeConstant: 0.02 }]),
    )
  })

  it('ramps one element down and the other up over the fade, and snaps them over none', () => {
    const context = new FakeAudioContext()
    const [from, to] = twoElements()
    if (!from || !to) throw new Error('No elements')
    const graph = soundGraph({ context, elements: [from, to] })
    const [outgoing, incoming] = context.gains
    graph.crossfade({ from, to, seconds: 6 })
    expect(outgoing?.gain.sets).toEqual([{ value: 1, time: 10 }])
    expect(outgoing?.gain.ramps).toEqual([{ value: 0, time: 16 }])
    expect(incoming?.gain.sets).toEqual([{ value: 0, time: 10 }])
    expect(incoming?.gain.ramps).toEqual([{ value: 1, time: 16 }])
    context.currentTime = 12
    graph.crossfade({ from: to, to: from, seconds: 0 })
    expect(incoming?.gain.cancels).toEqual([10, 12])
    expect(incoming?.gain.sets.at(-1)).toEqual({ value: 0, time: 12 })
    expect(outgoing?.gain.sets.at(-1)).toEqual({ value: 1, time: 12 })
    expect(outgoing?.gain.ramps).toHaveLength(1)
  })

  it('reads one level a band, low to high, each from 0 to 1', () => {
    const context = new FakeAudioContext()
    const graph = soundGraph({ context, elements: twoElements() })
    const [analyser] = context.analysers
    if (!analyser) throw new Error('No analyser')
    expect(graph.levels({ count: 4 })).toEqual([0, 0, 0, 0])
    analyser.spectrum.fill(255)
    expect(graph.levels({ count: 5 })).toEqual([1, 1, 1, 1, 1])
    analyser.spectrum.fill(51)
    graph.levels({ count: 3 }).forEach((level) => expect(level).toBeCloseTo(0.2, 5))
  })

  it('hears the bass in the first band alone', () => {
    const context = new FakeAudioContext()
    const graph = soundGraph({ context, elements: twoElements() })
    const [analyser] = context.analysers
    if (!analyser) throw new Error('No analyser')
    const binHz = context.sampleRate / SOUND_ANALYSER.fftSize
    analyser.spectrum.fill(255, 0, Math.floor(150 / binHz))
    const [bass, ...rest] = graph.levels({ count: 4 })
    expect(bass).toBeGreaterThan(0.5)
    expect(rest).toEqual([0, 0, 0])
  })
})
