import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { TOUCH_HOLD_DELAY_MS, TOUCH_HOLD_RATE, TOUCH_REWIND_TICK_MS } from '@raven/core'
import { act, fireEvent, render } from '@testing-library/react'
import { type EngineHandle, SURFACE_MARK } from '@/components/Player/engine'
import { useTouchGestures } from '@/components/Player/useTouchGestures'
import { initialVideoState } from '@/components/Player/videoState'

const WIDTH = 400

type Calls = { skips: number[]; taps: string[]; engine: string[] }

type HarnessProps = { calls: Calls; isPaused?: boolean }

const engineOf = ({ calls, isPaused = false }: HarnessProps): EngineHandle => ({
  state: { ...initialVideoState(100), paused: isPaused, waiting: false, rate: 1.5 },
  duration: 1000,
  position: { current: 100 },
  tracks: null,
  captionStyle: { size: 'medium', colour: 'white' },
  actions: {
    play: () => calls.engine.push('play'),
    pause: () => calls.engine.push('pause'),
    seek: (time) => calls.engine.push(`seek ${time}`),
    setVolume: () => {},
    setRate: (rate) => calls.engine.push(`rate ${rate}`),
    setAudio: () => {},
    setSubtitle: () => {},
    setCaptionStyle: () => {},
  },
  surface: null,
  focusSurface: () => {},
  drawsSubtitles: false,
  readStats: () => ({ engine: 'test', viewport: null, frame: null, frames: null }),
})

const Harness = ({ calls, isPaused }: HarnessProps) => {
  const gestures = useTouchGestures({
    engine: engineOf({ calls, isPaused }),
    onSkip: (direction) => calls.skips.push(direction),
    onTap: () => calls.taps.push('tap'),
  })
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      data-testid="stage"
      data-hold={gestures.hold ?? 'none'}
      {...gestures.handlers}
      onPointerDown={gestures.onPointerDown}
      onPointerMove={gestures.onPointerMove}
    >
      <div {...SURFACE_MARK} data-testid="surface" />
      <button type="button">Control</button>
    </div>
  )
}

const mount = (props: Omit<HarnessProps, 'calls'> = {}) => {
  const calls: Calls = { skips: [], taps: [], engine: [] }
  const view = render(<Harness calls={calls} {...props} />)
  const stage = view.getByTestId('stage')
  stage.getBoundingClientRect = () => new DOMRect(0, 0, WIDTH, 300)
  return { calls, stage, surface: view.getByTestId('surface'), button: view.getByRole('button') }
}

type TouchProps = { target: HTMLElement; x: number; pointerType?: string }

const press = ({ target, x, pointerType = 'touch' }: TouchProps) =>
  fireEvent.pointerDown(target, { pointerType, clientX: x, clientY: 10 })

const tap = (props: TouchProps) => {
  press(props)
  fireEvent.pointerUp(props.target, { pointerType: props.pointerType ?? 'touch' })
  fireEvent.click(props.target, { clientX: props.x, clientY: 10 })
}

const wait = (ms: number) => act(() => jest.advanceTimersByTime(ms))

describe('useTouchGestures', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('answers a lone tap once no second one follows', () => {
    const { calls, surface } = mount()
    tap({ target: surface, x: 300 })
    expect(calls.taps).toEqual([])
    wait(400)
    expect(calls).toMatchObject({ taps: ['tap'], skips: [] })
  })

  it('skips forward on a double tap on the right, back on the left, and on with each tap', () => {
    const { calls, surface } = mount()
    tap({ target: surface, x: 300 })
    tap({ target: surface, x: 320 })
    tap({ target: surface, x: 310 })
    wait(2_000)
    tap({ target: surface, x: 20 })
    tap({ target: surface, x: 30 })
    wait(400)
    expect(calls).toMatchObject({ taps: [], skips: [1, 1, -1] })
  })

  it('leaves a mouse and a touch on a control alone', () => {
    const { calls, surface, button } = mount()
    tap({ target: surface, x: 300, pointerType: 'mouse' })
    tap({ target: surface, x: 300, pointerType: 'mouse' })
    tap({ target: button, x: 300 })
    tap({ target: button, x: 300 })
    wait(400)
    expect(calls).toMatchObject({ taps: [], skips: [] })
  })

  it('plays at twice the speed while the right is held, then as it played before', () => {
    const { calls, stage, surface } = mount()
    press({ target: surface, x: 300 })
    wait(TOUCH_HOLD_DELAY_MS)
    expect(stage.dataset.hold).toBe('1')
    expect(calls.engine).toEqual([`rate ${TOUCH_HOLD_RATE}`])
    fireEvent.pointerUp(surface, { pointerType: 'touch' })
    fireEvent.click(surface, { clientX: 300 })
    wait(400)
    expect(stage.dataset.hold).toBe('none')
    expect(calls).toMatchObject({ taps: [], skips: [], engine: ['rate 2', 'rate 1.5'] })
  })

  it('starts a paused video for a hold on the right and pauses it again after', () => {
    const { calls, surface } = mount({ isPaused: true })
    press({ target: surface, x: 300 })
    wait(TOUCH_HOLD_DELAY_MS)
    fireEvent.pointerCancel(surface, { pointerType: 'touch' })
    expect(calls.engine).toEqual(['rate 2', 'play', 'rate 1.5', 'pause'])
  })

  it('runs the video backwards while the left is held, then plays on from there', () => {
    const { calls, stage, surface } = mount()
    press({ target: surface, x: 20 })
    wait(TOUCH_HOLD_DELAY_MS)
    expect(stage.dataset.hold).toBe('-1')
    wait(TOUCH_REWIND_TICK_MS * 2)
    fireEvent.pointerUp(surface, { pointerType: 'touch' })
    const [paused, ...rest] = calls.engine
    expect(paused).toBe('pause')
    expect(rest.at(-1)).toBe('play')
    const seeks = rest
      .filter((call) => call.startsWith('seek'))
      .map((call) => Number(call.slice(5)))
    expect(seeks.length).toBeGreaterThanOrEqual(3)
    expect(seeks.every((to) => to < 100)).toBe(true)
    expect(seeks).toEqual(seeks.toSorted((a, b) => b - a))
  })

  it('starts no hold for a finger that wanders', () => {
    const { calls, stage, surface } = mount()
    press({ target: surface, x: 300 })
    fireEvent.pointerMove(surface, { pointerType: 'touch', clientX: 340, clientY: 10 })
    wait(TOUCH_HOLD_DELAY_MS * 2)
    expect(stage.dataset.hold).toBe('none')
    expect(calls.engine).toEqual([])
  })
})
