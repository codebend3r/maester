import { describe, expect, test } from 'bun:test'
import { LOOP_LAG_MS, createMarks } from '@/main/player/marks'
import { fakeService, fakeTimers } from '@/main/test/playerFakes'

const LOAD = {
  type: 'load',
  source: { kind: 'file', fileId: 'f1' },
  start: 0,
  audio: null,
  subtitle: null,
} as const

const fakeHistogram = () => {
  const calls: string[] = []
  const state = { p99: 12_400_000 }
  return {
    calls,
    state,
    histogram: {
      enable: () => {
        calls.push('enable')
        return true
      },
      disable: () => {
        calls.push('disable')
        return true
      },
      reset: () => {
        calls.push('reset')
      },
      percentile: (percentile: number) => {
        calls.push(`percentile ${percentile}`)
        return state.p99
      },
    },
  }
}

type SetupProps = { isEnabled?: boolean }

const setup = ({ isEnabled = true }: SetupProps = {}) => {
  const lines: string[] = []
  const clock = { now: 1000 }
  const timers = fakeTimers()
  const monitor = fakeHistogram()
  const marks = createMarks({
    isEnabled,
    now: () => clock.now,
    write: (line) => lines.push(line),
    timers: timers.timers,
    histogram: () => monitor.histogram,
  })
  return { marks, lines, clock, timers, monitor }
}

describe('first frame', () => {
  test('is measured from the last load the service was asked for, once', async () => {
    const { marks, lines, clock } = setup()
    const service = fakeService()
    const tracked = marks.tracking(service.service)
    await tracked.handle(LOAD)
    clock.now = 1300
    await tracked.handle(LOAD)
    clock.now = 1712.4
    marks.firstFrame()
    marks.firstFrame()
    expect(lines).toEqual(['raven-first-frame-ms 412\n'])
    expect(service.handled).toEqual([LOAD, LOAD])
  })

  test('a first frame with no load behind it writes nothing', () => {
    const { marks, lines } = setup()
    marks.firstFrame()
    expect(lines).toEqual([])
  })

  test('the first frame after an early open also gives the open to frame time, from the open', async () => {
    const { marks, lines, clock } = setup()
    const tracked = marks.tracking(fakeService().service)
    marks.opened()
    clock.now = 1100
    await tracked.handle(LOAD)
    clock.now = 1500.6
    marks.firstFrame()
    expect(lines).toEqual(['raven-first-frame-ms 401\n', 'raven-open-to-frame-ms 501\n'])
  })

  test('a later load only gives its first frame time, and a later open never measures again', async () => {
    const { marks, lines, clock } = setup()
    const tracked = marks.tracking(fakeService().service)
    marks.opened()
    await tracked.handle(LOAD)
    clock.now = 1200
    marks.firstFrame()
    marks.opened()
    clock.now = 2000
    await tracked.handle(LOAD)
    clock.now = 2300
    marks.firstFrame()
    expect(lines).toEqual([
      'raven-first-frame-ms 200\n',
      'raven-open-to-frame-ms 200\n',
      'raven-first-frame-ms 300\n',
    ])
  })

  test('a burst of opens is measured from the first', async () => {
    const { marks, lines, clock } = setup()
    const tracked = marks.tracking(fakeService().service)
    marks.opened()
    clock.now = 1050
    marks.opened()
    await tracked.handle(LOAD)
    clock.now = 1400
    marks.firstFrame()
    expect(lines).toContain('raven-open-to-frame-ms 400\n')
  })

  test('a first frame with no open behind it gives no open to frame time', async () => {
    const { marks, lines, clock } = setup()
    await marks.tracking(fakeService().service).handle(LOAD)
    clock.now = 1250
    marks.firstFrame()
    expect(lines).toEqual(['raven-first-frame-ms 250\n'])
  })

  test('packaged, nothing is written', async () => {
    const { marks, lines } = setup({ isEnabled: false })
    marks.opened()
    await marks.tracking(fakeService().service).handle(LOAD)
    marks.firstFrame()
    expect(lines).toEqual([])
  })
})

describe('loop lag', () => {
  test('while playing, prints the p99 in whole ms every LOOP_LAG_MS and resets', () => {
    const { marks, lines, timers, monitor } = setup()
    marks.playing(true)
    marks.playing(true)
    expect([...timers.pending.values()].map(({ ms }) => ms)).toEqual([LOOP_LAG_MS])
    timers.fire()
    monitor.state.p99 = 20_600_000
    timers.fire()
    expect(lines).toEqual(['raven-loop-lag-p99-ms 12\n', 'raven-loop-lag-p99-ms 21\n'])
    expect(monitor.calls).toEqual(['enable', 'percentile 99', 'reset', 'percentile 99', 'reset'])
  })

  test('stopping disables the histogram and clears the timer; playing again starts afresh', () => {
    const { marks, timers, monitor } = setup()
    marks.playing(true)
    marks.playing(false)
    marks.playing(false)
    expect(timers.pending.size).toBe(0)
    marks.playing(true)
    expect(monitor.calls).toEqual(['enable', 'disable', 'reset', 'enable'])
    expect(timers.pending.size).toBe(1)
  })

  test('packaged, nothing is measured', () => {
    const { marks, timers, monitor } = setup({ isEnabled: false })
    marks.playing(true)
    expect(timers.pending.size).toBe(0)
    expect(monitor.calls).toEqual([])
  })
})
