import { describe, expect, it } from 'bun:test'
import { browserClock } from '@/browserDownloads/clock'

describe('browserClock', () => {
  it('tells the time', () => {
    expect(Math.abs(browserClock.now() - Date.now())).toBeLessThan(1000)
  })

  it('waits as long as it is asked', async () => {
    const before = Date.now()
    await browserClock.sleep({ ms: 15, signal: new AbortController().signal })
    expect(Date.now() - before).toBeGreaterThanOrEqual(10)
  })

  it('wakes at once when its signal aborts, before or while it waits', async () => {
    const stopped = new AbortController()
    stopped.abort()
    await browserClock.sleep({ ms: 60_000, signal: stopped.signal })
    const stopping = new AbortController()
    const slept = browserClock.sleep({ ms: 60_000, signal: stopping.signal })
    stopping.abort()
    await slept
    expect(stopping.signal.aborted).toBe(true)
  })
})
