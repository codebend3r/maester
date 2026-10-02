import { describe, expect, it } from 'vitest'
import { createTaskQueue, mapWithConcurrency } from '@/scanner/concurrency.js'

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

describe('createTaskQueue', () => {
  it('runs each key once and settles when drained', async () => {
    const queue = createTaskQueue({ concurrency: 2 })
    const ran: string[] = []
    const task = (key: string) => async () => {
      await tick(5)
      ran.push(key)
    }
    queue.push('a', task('a'))
    queue.push('a', task('a again'))
    queue.push('b', task('b'))
    queue.push('c', task('c'))
    await queue.idle()
    expect(ran.toSorted()).toEqual(['a', 'b', 'c'])
    expect(queue.size()).toBe(0)
  })

  it('survives a failing task', async () => {
    const queue = createTaskQueue({ concurrency: 1 })
    const ran: string[] = []
    queue.push('bad', async () => {
      throw new Error('boom')
    })
    queue.push('good', async () => {
      ran.push('good')
    })
    await queue.idle()
    expect(ran).toEqual(['good'])
  })

  it('drops a cancelled task before it starts', async () => {
    const queue = createTaskQueue({ concurrency: 1 })
    const ran: string[] = []
    queue.push('first', async () => {
      await tick(5)
      ran.push('first')
    })
    queue.push('second', async () => {
      ran.push('second')
    })
    queue.cancel('second')
    await queue.idle()
    expect(ran).toEqual(['first'])
  })
})
