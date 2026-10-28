import { describe, expect, it } from 'vitest'
import { StartupWork } from '@/startupWork'

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('StartupWork', () => {
  it('holds every step until the server listens', async () => {
    const work = new StartupWork(true)
    const ran: string[] = []
    work.add([() => ran.push('scan')])
    await tick(200)
    expect(ran).toEqual([])
    work.release()
    await work.whenDone()
    expect(ran).toEqual(['scan'])
  })

  it('runs the steps at once for an app that never listens', async () => {
    const work = new StartupWork(false)
    const ran: string[] = []
    work.add([() => ran.push('scan')])
    await work.whenDone()
    expect(ran).toEqual(['scan'])
  })

  it('runs the steps in the order added, leaving the event loop free between them', async () => {
    const work = new StartupWork(false)
    const ran: string[] = []
    work.add([() => ran.push('titles'), () => ran.push('library 1')])
    work.add([() => ran.push('scan 1')])
    // A request that takes several turns of the loop is answered before the first step.
    const answered = new Promise((resolve) => setImmediate(resolve))
      .then(() => new Promise((resolve) => setImmediate(resolve)))
      .then(() => new Promise((resolve) => setImmediate(resolve)))
      .then(() => ran.push('request'))
    await Promise.all([answered, work.whenDone()])
    expect(ran).toEqual(['request', 'titles', 'library 1', 'scan 1'])
  })

  it('runs the next step after one that throws', async () => {
    const work = new StartupWork(false)
    const ran: string[] = []
    work.add([
      () => {
        throw new Error('SQLITE_BUSY')
      },
      () => ran.push('library 2'),
    ])
    await work.whenDone()
    expect(ran).toEqual(['library 2'])
  })

  it('drops the steps still waiting once the app closes', async () => {
    const work = new StartupWork(false)
    const ran: string[] = []
    work.add([() => ran.push('scan')])
    work.onModuleDestroy()
    await work.whenDone()
    expect(ran).toEqual([])
  })
})
