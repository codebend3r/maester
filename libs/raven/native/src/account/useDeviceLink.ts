import type { DeviceSession } from '@raven/core'
import { useEffect, useRef, useState } from 'react'

import {
  DEVICE_LINK_STATES,
  type DeviceLink,
  openDeviceSignIn,
  watchDeviceSignIn,
} from '@/account/deviceLink'
import { openFetch } from '@/servers/serverFetch'

type WaitProps = { ms: number; signal: AbortSignal }

/** A wait that a gone screen cuts short: its timer is dropped and it never ends. */
const waitUnless = ({ ms, signal }: WaitProps): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
  })

type UseDeviceLinkProps = {
  /** The raven server the account signs in to. */
  origin: string
  /** What the TV calls itself to whoever approves its code; undefined asks for no code. */
  deviceName: string | undefined
  /** Whether the screen is asking for the account, the only step a code is offered on. */
  isAsking: boolean
  onApproved: (session: DeviceSession) => void
}

/**
 * A TV's code to scan: starts a sign-in while the screen asks for the account, keeps the code to
 * show as `link` (null where there is none), and hands `onApproved` the session of whoever
 * approved it. `renewLink` asks for a new code once the last ran out.
 */
export const useDeviceLink = ({ origin, deviceName, isAsking, onApproved }: UseDeviceLinkProps) => {
  const [link, setLink] = useState<DeviceLink | null>(null)
  // A watch ends with its last code; the viewer's ask for a new one starts another.
  const [isWatching, setWatching] = useState(true)
  // The watch outlives renders, so it ends through the latest `onApproved`, not the first.
  const approved = useRef(onApproved)
  useEffect(() => {
    approved.current = onApproved
  })

  useEffect(() => {
    if (deviceName === undefined || !isAsking || !isWatching) return undefined
    const stop = new AbortController()
    const { signal } = stop
    const watched = watchDeviceSignIn({
      open: () => openDeviceSignIn({ origin, deviceName, fetch: openFetch }),
      wait: (ms) => waitUnless({ ms, signal }),
      now: Date.now,
      isStopped: () => signal.aborted,
      onLink: setLink,
    })
    const end = (session: DeviceSession | null) => {
      if (signal.aborted) return
      setWatching(false)
      if (session !== null) approved.current(session)
    }
    // A watch that failed, as on a lost network, ends as a code that ran out: the viewer asks again.
    const fail = () => {
      if (signal.aborted) return
      setLink({ kind: DEVICE_LINK_STATES.expired })
      setWatching(false)
    }
    void watched.then(end, fail)
    return () => stop.abort()
  }, [origin, deviceName, isAsking, isWatching])

  return { link, renewLink: () => setWatching(true) }
}
