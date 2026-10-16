import { describe, expect, it } from 'bun:test'
import { createNodeTimers } from '@/main/timers'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('createNodeTimers', () => {
  it('runs a timer after its delay', async () => {
    const timers = createNodeTimers()
    const runs: string[] = []
    timers.set(() => runs.push('ran'), 5)
    await sleep(20)
    expect(runs).toEqual(['ran'])
  })

  it('cancels a timer it set', async () => {
    const timers = createNodeTimers()
    const runs: string[] = []
    const handle = timers.set(() => runs.push('ran'), 5)
    timers.clear(handle)
    await sleep(20)
    expect(runs).toEqual([])
  })

  it('ignores a handle it never gave out', async () => {
    const timers = createNodeTimers()
    const runs: string[] = []
    timers.set(() => runs.push('ran'), 5)
    timers.clear('not a handle')
    timers.clear(undefined)
    await sleep(20)
    expect(runs).toEqual(['ran'])
  })
})
