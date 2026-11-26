import { describe, expect, it } from 'bun:test'
import { ACCOUNT_DATA_REFRESH_MS } from '@raven/core'

import { keepSynced } from '@/servers/keepSynced'

type Listener = (isForeground: boolean) => void

type HarnessProps = { isForeground: boolean }

const harness = ({ isForeground }: HarnessProps) => {
  const calls = { syncs: 0, stops: 0, unwatched: 0 }
  const timers: { run: () => void; ms: number }[] = []
  const listeners: Listener[] = []
  const stop = keepSynced({
    sync: async () => {
      calls.syncs += 1
    },
    app: {
      isForeground: () => isForeground,
      watch: (onChange) => {
        listeners.push(onChange)
        return () => {
          calls.unwatched += 1
        }
      },
    },
    repeat: (timer) => {
      timers.push(timer)
      return () => {
        calls.stops += 1
      }
    },
  })
  const tell = (value: boolean) => listeners.forEach((listener) => listener(value))
  return { calls, timers, tell, stop }
}

describe('keepSynced', () => {
  it('reads again every refresh while the app is in front', () => {
    const { calls, timers } = harness({ isForeground: true })
    expect(timers.map(({ ms }) => ms)).toEqual([ACCOUNT_DATA_REFRESH_MS])
    timers[0]?.run()
    timers[0]?.run()
    expect(calls.syncs).toBe(2)
  })

  it('stops in the background and reads at once on coming back', () => {
    const { calls, timers, tell } = harness({ isForeground: true })
    tell(false)
    expect(calls.stops).toBe(1)
    tell(true)
    expect(calls.syncs).toBe(1)
    expect(timers).toHaveLength(2)
  })

  it('reads nothing more for a pass through inactive', () => {
    const { calls, timers, tell } = harness({ isForeground: true })
    tell(true)
    expect(calls.syncs).toBe(0)
    expect(timers).toHaveLength(1)
  })

  it('starts no timer for an app opened in the background, until it comes forward', () => {
    const { calls, timers, tell } = harness({ isForeground: false })
    expect(timers).toHaveLength(0)
    tell(true)
    expect(calls.syncs).toBe(1)
    expect(timers).toHaveLength(1)
  })

  it('lets go of the app and the timer when stopped', () => {
    const { calls, stop } = harness({ isForeground: true })
    stop()
    expect(calls).toEqual({ syncs: 0, stops: 1, unwatched: 1 })
  })
})
