/** A value an `AudioParam` was set or ramped to, and when. */
type Scheduled = { value: number; time: number }

/** An `AudioParam` that records what it was told. */
class FakeParam {
  value: number
  readonly sets: Scheduled[] = []
  readonly ramps: Scheduled[] = []
  readonly cancels: number[] = []

  constructor(value: number) {
    this.value = value
  }

  setValueAtTime(value: number, time: number): FakeParam {
    this.sets.push({ value, time })
    this.value = value
    return this
  }

  linearRampToValueAtTime(value: number, time: number): FakeParam {
    this.ramps.push({ value, time })
    this.value = value
    return this
  }

  cancelScheduledValues(time: number): FakeParam {
    this.cancels.push(time)
    return this
  }
}

class FakeNode {
  readonly outputs: FakeNode[] = []

  connect(destination: FakeNode): FakeNode {
    this.outputs.push(destination)
    return destination
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1)
}

class FakeFilter extends FakeNode {
  type: BiquadFilterType = 'lowpass'
  readonly frequency = new FakeParam(350)
  readonly Q = new FakeParam(1)
  readonly gain = new FakeParam(0)
}

/** The fake contexts made since the last `forgetContexts`, oldest first. */
const made: FakeAudioContext[] = []

/**
 * An `AudioContext` that keeps every node it made and what each was told,
 * for happy-dom, which has no Web Audio. Like a browser's, it refuses to
 * take a media element's sound twice.
 */
export class FakeAudioContext {
  currentTime = 10
  state: AudioContextState = 'suspended'
  readonly destination = new FakeNode()
  readonly sources = new Map<HTMLMediaElement, FakeNode>()
  readonly gains: FakeGain[] = []
  readonly filters: FakeFilter[] = []
  resumes = 0
  isClosed = false

  constructor() {
    made.push(this)
  }

  createMediaElementSource(element: HTMLMediaElement): FakeNode {
    if (this.sources.has(element)) throw new Error('The element is already routed')
    const source = new FakeNode()
    this.sources.set(element, source)
    return source
  }

  createGain(): FakeGain {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
  }

  createBiquadFilter(): FakeFilter {
    const filter = new FakeFilter()
    this.filters.push(filter)
    return filter
  }

  resume(): Promise<void> {
    this.resumes += 1
    this.state = 'running'
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.isClosed = true
    return Promise.resolve()
  }
}

/** The fake contexts made so far. */
export const fakeContexts = (): readonly FakeAudioContext[] => made

/** Puts `FakeAudioContext` where a browser's `AudioContext` is, and forgets the ones made before. */
export const installAudioContext = (): void => {
  made.length = 0
  Object.defineProperty(globalThis, 'AudioContext', {
    value: FakeAudioContext,
    configurable: true,
    writable: true,
  })
}

/** Takes `AudioContext` away again, as happy-dom has it. */
export const removeAudioContext = (): void => {
  Reflect.deleteProperty(globalThis, 'AudioContext')
}
