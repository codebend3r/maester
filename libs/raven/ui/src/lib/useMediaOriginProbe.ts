import { type ApiClient, pickOrigin } from '@raven/core'
import { useCallback, useEffect, useRef } from 'react'
import { type ProbeFetch, probeOrigins } from '@/lib/probeOrigins'
import { PICK_FRESH_MS, isFreshPick, useMediaOrigin } from '@/stores/mediaOrigin'

type ProbeSetup = {
  api: ApiClient
  /** Whether the host may ask the server yet; nothing is probed, `reprobe` included, until it is. */
  isEnabled: boolean
  fetch?: ProbeFetch
  now?: () => number
}

const VISIBILITY_STATES = { hidden: 'hidden' } as const satisfies Record<
  string,
  DocumentVisibilityState
>

/** The window and document events that ask for a new probe. */
export const PROBE_EVENTS = { online: 'online', visibilityChange: 'visibilitychange' } as const

const browserFetch: ProbeFetch = (url, init) => window.fetch(url, init)
const browserNow = (): number => performance.now()

/**
 * Chooses where media plays from: probes the server's origins on mount, when
 * the network comes back, and when the tab returns after a long absence, and
 * keeps the winner in `useMediaOrigin`. A host mounts it once, near the root,
 * and enables it once the server answers its calls.
 */
export const useMediaOriginProbe = ({
  api,
  isEnabled,
  fetch = browserFetch,
  now = browserNow,
}: ProbeSetup): { reprobe: () => void } => {
  const setup = useRef({ api, fetch, now, isEnabled })
  // Written in an effect, before the effects below run, so a probe always sees the latest props.
  useEffect(() => {
    setup.current = { api, fetch, now, isEnabled }
  }, [api, fetch, now, isEnabled])
  const hiddenAt = useRef<number | null>(null)
  const isForcedPending = useRef(false)

  type RunProbeProps = { isForced: boolean }

  const run = useCallback(async function runProbe({ isForced }: RunProbeProps) {
    if (!setup.current.isEnabled) return
    const { isProbing, setPick, setProbing } = useMediaOrigin.getState()
    if (isProbing) {
      // Unreachable or back online while a probe runs: what it measures may predate that, so go again after it.
      if (isForced) isForcedPending.current = true
      return
    }
    setProbing(true)
    try {
      const current = setup.current
      const { origins } = await current.api.getMediaOrigins()
      if (origins.length === 0) return setPick(null)
      const { pick } = useMediaOrigin.getState()
      const isKept =
        !isForced &&
        pick !== null &&
        isFreshPick({ pick, now: Date.now() }) &&
        origins.some(({ url }) => url === pick.origin.url)
      if (isKept) return
      const winner = pickOrigin(await probeOrigins({ origins, ...current }))
      setPick(winner ? { origin: winner, at: Date.now() } : null)
    } catch {
      // The pick stays as it was; the next event tries again.
    } finally {
      setProbing(false)
      if (isForcedPending.current) {
        isForcedPending.current = false
        void runProbe({ isForced: true })
      }
    }
  }, [])

  const reprobe = useCallback(() => {
    void run({ isForced: true })
  }, [run])

  useEffect(() => {
    if (isEnabled) void run({ isForced: false })
  }, [run, isEnabled])

  useEffect(() => {
    hiddenAt.current = document.visibilityState === VISIBILITY_STATES.hidden ? Date.now() : null
    const onVisibility = () => {
      if (document.visibilityState === VISIBILITY_STATES.hidden) {
        hiddenAt.current = Date.now()
        return
      }
      const wasHiddenFor = hiddenAt.current === null ? 0 : Date.now() - hiddenAt.current
      hiddenAt.current = null
      if (wasHiddenFor >= PICK_FRESH_MS) reprobe()
    }
    window.addEventListener(PROBE_EVENTS.online, reprobe)
    document.addEventListener(PROBE_EVENTS.visibilityChange, onVisibility)
    return () => {
      window.removeEventListener(PROBE_EVENTS.online, reprobe)
      document.removeEventListener(PROBE_EVENTS.visibilityChange, onVisibility)
    }
  }, [reprobe])

  return { reprobe }
}
