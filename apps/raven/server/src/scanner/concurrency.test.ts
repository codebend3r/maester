import { describe, expect, it } from 'vitest'
import {
  createGate,
  createRateLimit,
  createTaskQueue,
  mapWithConcurrency,
} from '@/scanner/concurrency'

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('mapWithConcurrency', () => {
  it('keeps input order and never exceeds the limit', async () => {
    const state = { active: 0, peak: 0 }
    const results = await mapWithConcurrency({
      items: [30, 5, 20, 1, 10],
      limit: 2,
      fn: async (ms) => {
        state.active += 1
        state.peak = Math.max(state.peak, state.active)
        await tick(ms)
        state.active -= 1
        return ms * 2
      },
    })
    expect(results).toEqual([60, 10, 40, 2, 20])
    expect(state.peak).toBe(2)
  })

  it('handles an empty list', async () => {
    await expect(mapWithConcurrency({ items: [], limit: 4, fn: async () => 1 })).resolves.toEqual(
      [],
    )
  })
})

describe('createGate', () => {
  it('lets no more than its limit through at once, however many callers there are', async () => {
    const gate = createGate({ limit: 2 })
    const state = { active: 0, peak: 0 }
    const task = (value: number) => async () => {
      state.active += 1
      state.peak = Math.max(state.peak, state.active)
      await tick(5)
      state.active -= 1
      return value
    }
    const results = await Promise.all([1, 2, 3, 4, 5].map((value) => gate.run(task(value))))
    expect(results).toEqual([1, 2, 3, 4, 5])
    expect(state.peak).toBe(2)
  })

  it('frees the slot of a task that fails', async () => {
    const gate = createGate({ limit: 1 })
    await expect(gate.run(async () => Promise.reject(new Error('EIO')))).rejects.toThrow('EIO')
    await expect(gate.run(async () => 'next')).resolves.toBe('next')
  })
})

describe('createTaskQueue', () => {
  it('runs each key once and settles when drained', async () => {
    const queue = createTaskQueue({ concurrency: 2 })
    const ran: string[] = []
    const task = (key: string) => async () => {
      await tick(5)
      ran.push(key)
    }
    queue.push({ key: 'a', task: task('a') })
    queue.push({ key: 'a', task: task('a again') })
    queue.push({ key: 'b', task: task('b') })
    queue.push({ key: 'c', task: task('c') })
    await queue.idle()
    expect(ran.toSorted()).toEqual(['a', 'b', 'c'])
    expect(queue.size()).toBe(0)
  })

  it('runs a key asked for again while it runs once more after it, and only once', async () => {
    const queue = createTaskQueue({ concurrency: 1 })
    const ran: string[] = []
    const task = (label: string) => async () => {
      await tick(5)
      ran.push(label)
    }
    queue.push({ key: 'a', task: task('first') })
    queue.again({ key: 'a', task: task('second') })
    queue.again({ key: 'a', task: task('third') })
    queue.push({ key: 'a', task: task('ignored') })
    // Queued and not yet running, it is an ordinary push.
    queue.again({ key: 'b', task: task('b') })
    queue.again({ key: 'b', task: task('b ignored') })
    expect(queue.size()).toBe(3)
    await queue.idle()
    expect(ran).toEqual(['first', 'b', 'third'])
  })

  it('survives a failing task', async () => {
    const queue = createTaskQueue({ concurrency: 1 })
    const ran: string[] = []
    queue.push({
      key: 'bad',
      task: async () => {
        throw new Error('boom')
      },
    })
    queue.push({
      key: 'good',
      task: async () => {
        ran.push('good')
      },
    })
    await queue.idle()
    expect(ran).toEqual(['good'])
  })

  it('drops a cancelled task before it starts', async () => {
    const queue = createTaskQueue({ concurrency: 1 })
    const ran: string[] = []
    queue.push({
      key: 'first',
      task: async () => {
        await tick(5)
        ran.push('first')
      },
    })
    queue.push({
      key: 'second',
      task: async () => {
        ran.push('second')
      },
    })
    queue.cancel('second')
    await queue.idle()
    expect(ran).toEqual(['first'])
  })
})

describe('createRateLimit', () => {
  /** A clock that only moves when the limit sleeps, so the test reads its schedule. */
  const fakeClock = () => {
    const clock: { now: number; slept: number[] } = { now: 0, slept: [] }
    return {
      clock,
      now: () => clock.now,
      sleep: async (ms: number) => {
        clock.slept.push(ms)
        clock.now += ms
      },
    }
  }

  it('spaces starts a slot apart', async () => {
    const { clock, now, sleep } = fakeClock()
    const limit = createRateLimit({ perSecond: 4, inFlight: 1, now, sleep })
    const started: number[] = []
    await Promise.all(
      [1, 2, 3].map(() =>
        limit.run(async () => {
          started.push(clock.now)
        }),
      ),
    )
    expect(started).toEqual([0, 250, 500])
  })

  it('halves the rate when told to slow down, until reset', async () => {
    const { clock, now, sleep } = fakeClock()
    const limit = createRateLimit({ perSecond: 10, inFlight: 1, now, sleep })
    limit.slowDown()
    await limit.run(async () => undefined)
    await limit.run(async () => undefined)
    expect(clock.slept).toEqual([200])
    limit.reset()
    await limit.run(async () => undefined)
    await limit.run(async () => undefined)
    expect(clock.slept).toEqual([200, 200, 100])
  })
})
