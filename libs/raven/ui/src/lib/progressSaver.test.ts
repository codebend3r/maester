import { describe, expect, it, mock } from 'bun:test'
import type { ProgressReport } from '@raven/core'
import { SAVE_RETRY_MS, createProgressSaver } from '@/lib/progressSaver'

/** A send each of whose calls waits until the test answers it. */
const heldSend = () => {
  const calls: { position: number; answer: (isSaved: boolean) => void }[] = []
  const send = mock(
    ({ position }: ProgressReport) =>
      new Promise<void>((resolve, reject) => {
        calls.push({
          position,
          answer: (isSaved) => (isSaved ? resolve() : reject(new Error('offline'))),
        })
      }),
  )
  return { send, calls }
}

const at = (position: number): ProgressReport => ({ position, audio: null })

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createProgressSaver', () => {
  it('sends one position at a time, the newest once the one in flight lands', async () => {
    const { send, calls } = heldSend()
    const saver = createProgressSaver({ send })
    saver.save(at(10))
    saver.save(at(20))
    saver.save(at(30))
    expect(send).toHaveBeenCalledTimes(1)
    calls[0]?.answer(true)
    await tick()
    expect(calls.map(({ position }) => position)).toEqual([10, 30])
    calls[1]?.answer(true)
    await saver.settled()
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('tries a failed save again after each delay until it lands', async () => {
    const send = mock(async (_report: ProgressReport) => {
      if (send.mock.calls.length < 3) throw new Error('offline')
    })
    const wait = mock(async (_ms: number) => undefined)
    const saver = createProgressSaver({ send, wait })
    saver.save(at(42))
    await saver.settled()
    expect(send.mock.calls.map(([{ position }]) => position)).toEqual([42, 42, 42])
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([SAVE_RETRY_MS[0], SAVE_RETRY_MS[1]])
  })

  it('retries the newer position, not the failed one, when one came while it waited', async () => {
    const { send, calls } = heldSend()
    const waited: (() => void)[] = []
    const wait = () => new Promise<void>((resolve) => waited.push(resolve))
    const saver = createProgressSaver({ send, wait })
    saver.save(at(10))
    calls[0]?.answer(false)
    await tick()
    saver.save(at(20))
    waited[0]?.()
    await tick()
    expect(calls.map(({ position }) => position)).toEqual([10, 20])
    calls[1]?.answer(true)
    await saver.settled()
  })

  it('gives a position up once every retry failed, and settles without rejecting', async () => {
    const send = mock(async (_report: ProgressReport) => {
      throw new Error('offline')
    })
    const saver = createProgressSaver({ send, wait: async () => undefined })
    saver.save(at(42))
    await saver.settled()
    expect(send).toHaveBeenCalledTimes(SAVE_RETRY_MS.length + 1)
    saver.save(at(50))
    await saver.settled()
    expect(send).toHaveBeenLastCalledWith(at(50))
  })

  it('settles at once when nothing was asked for', async () => {
    const send = mock(async (_report: ProgressReport) => undefined)
    await createProgressSaver({ send }).settled()
    expect(send).not.toHaveBeenCalled()
  })
})
