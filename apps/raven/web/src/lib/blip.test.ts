import { afterAll, describe, expect, it } from 'bun:test'
import { BLIPS, playBlip } from '@/lib/blip'

type Ramp = { value: number; time: number }

class FakeParam {
  readonly sets: Ramp[] = []
  readonly ramps: Ramp[] = []

  setValueAtTime(value: number, time: number) {
    this.sets.push({ value, time })
  }

  exponentialRampToValueAtTime(value: number, time: number) {
    this.ramps.push({ value, time })
  }
}

class FakeNode {
  readonly frequency = new FakeParam()
  readonly gain = new FakeParam()
  readonly starts: number[] = []
  readonly stops: number[] = []
  type = ''

  connect<Next>(next: Next): Next {
    return next
  }

  start(time: number) {
    this.starts.push(time)
  }

  stop(time: number) {
    this.stops.push(time)
  }
}

const made: FakeContext[] = []

class FakeContext {
  state = 'suspended'
  readonly currentTime = 2
  readonly destination = new FakeNode()
  readonly oscillators: FakeNode[] = []
  resumes = 0

  constructor() {
    made.push(this)
  }

  createOscillator() {
    const oscillator = new FakeNode()
    this.oscillators.push(oscillator)
    return oscillator
  }

  createGain() {
    return new FakeNode()
  }

  async resume() {
    this.resumes += 1
  }
}

describe('playBlip', () => {
  afterAll(() => {
    Reflect.deleteProperty(globalThis, 'AudioContext')
  })

  it('does nothing where the browser has no Web Audio', () => {
    Reflect.deleteProperty(globalThis, 'AudioContext')
    expect(() => playBlip({ blip: BLIPS.open })).not.toThrow()
    expect(made).toHaveLength(0)
  })

  it('drops the blip and asks to start while the page may not sound yet', () => {
    Object.defineProperty(globalThis, 'AudioContext', { value: FakeContext, configurable: true })
    playBlip({ blip: BLIPS.open })
    const [context] = made
    expect(context?.resumes).toBe(1)
    expect(context?.oscillators).toHaveLength(0)
  })

  it('glides from one pitch to the other through the one context, then stops', () => {
    const [context] = made
    if (!context) throw new Error('no context was made')
    context.state = 'running'
    playBlip({ blip: BLIPS.close })
    expect(made).toHaveLength(1)
    const [oscillator] = context.oscillators
    expect(oscillator?.type).toBe('sine')
    expect(oscillator?.frequency.sets).toEqual([{ value: BLIPS.close.from, time: 2 }])
    expect(oscillator?.frequency.ramps).toEqual([{ value: BLIPS.close.to, time: 2.11 }])
    expect(oscillator?.starts).toEqual([2])
    expect(oscillator?.stops).toEqual([2.11])
  })
})
