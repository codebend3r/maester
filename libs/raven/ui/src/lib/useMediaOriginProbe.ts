import { type ApiClient, pickOrigin } from '@raven/core'
import { useCallback, useEffect, useRef } from 'react'
import { type ProbeFetch, probeOrigins } from '@/lib/probeOrigins'
import { PICK_FRESH_MS, isFreshPick, useMediaOrigin } from '@/stores/mediaOrigin'

type ProbeSetup = {
  api: ApiClient
  fetch?: ProbeFetch
  now?: () => number
}

const browserFetch: ProbeFetch = (url, init) => window.fetch(url, init)
const browserNow = (): number => performance.now()

/**
 * Chooses where media plays from: probes the server's origins on mount, when
 * the network comes back, and when the tab returns after a long absence, and
 * keeps the winner in `useMediaOrigin`. A host mounts it once, near the root.
 */
export const useMediaOriginProbe = ({
  api,
  fetch = browserFetch,
  now = browserNow,
}: ProbeSetup): { reprobe: () => void } => {
  const setup = useRef({ api, fetch, now })
  // Written in an effect, before the effects below run, so a probe always sees the latest props.
  useEffect(() => {
    setup.current = { api, fetch, now }
  }, [api, fetch, now])
  const hiddenAt = useRef<number | null>(null)

  const run = useCallback(async ({ isForced }: { isForced: boolean }) => {
    const { isProbing, setPick, setProbing } = useMediaOrigin.getState()
    if (isProbing) return
    setProbing(true)
    try {
      const current = setup.current
      const { origins } = await current.api.getMediaOrigins()
      if (origins.length === 0) return setPick(null)
      const { pick } = useMediaOrigin.getState()
      const isKept =
        !isForced &&
        isFreshPick({ pick, now: Date.now() }) &&
        origins.some(({ url }) => url === pick?.origin.url)
      if (isKept) return
      const winner = pickOrigin(await probeOrigins({ origins, ...current }))
      setPick(winner ? { origin: winner, at: Date.now() } : null)
    } catch {
      // The pick stays as it was; the next event tries again.
    } finally {
      setProbing(false)
    }
  }, [])

  const reprobe = useCallback(() => {
    void run({ isForced: true })
  }, [run])

  useEffect(() => {
    void run({ isForced: false })
  }, [run])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now()
        return
      }
      const wasHiddenFor = hiddenAt.current === null ? 0 : Date.now() - hiddenAt.current
      hiddenAt.current = null
      if (wasHiddenFor >= PICK_FRESH_MS) reprobe()
    }
    window.addEventListener('online', reprobe)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('online', reprobe)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reprobe])

  return { reprobe }
}
