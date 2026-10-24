import { APP_CALL_METHODS } from '@raven/core'

import { checkAppCall } from '@/servers/allowlist'
import type { ProbeFetch } from '@/servers/mediaAccess'
import { FETCH_CREDENTIALS } from '@/servers/serverFetch'

const SIGNAL_EVENTS = { abort: 'abort' } as const

/**
 * The slice of React Native's `fetch` a ping needs. Its response arrives once the body has, and
 * `blob` hands the body over by size without copying it into JavaScript.
 */
type PingFetch = (
  url: string,
  init: { signal: AbortSignal; credentials: typeof FETCH_CREDENTIALS.omit },
) => Promise<{ ok: boolean; blob: () => Promise<{ size: number }> }>

/**
 * `ProbeFetch` over the platform's `fetch`, timed by `clock` in milliseconds. A ping carries no
 * cookie: it goes to a media origin, and only the server's own API gets its cookies. It rejects
 * for an address outside the app's calls, a failed request, or one that outlasts `timeoutMs`,
 * which it also aborts.
 */
export const probeFetchOf =
  ({ fetch, clock }: { fetch: PingFetch; clock: () => number }): ProbeFetch =>
  async ({ url, timeoutMs }) => {
    checkAppCall({ method: APP_CALL_METHODS.get, url })
    const controller = new AbortController()
    // A fetch that ignores its signal would otherwise hold the probe past its time.
    const timedOut = new Promise<never>((_, reject) =>
      controller.signal.addEventListener(
        SIGNAL_EVENTS.abort,
        () => reject(new Error('The ping took too long')),
        { once: true },
      ),
    )
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const startedAt = clock()
      const response = await Promise.race([
        fetch(url, { signal: controller.signal, credentials: FETCH_CREDENTIALS.omit }),
        timedOut,
      ])
      if (!response.ok) return { ok: false, bytes: 0, elapsedMs: clock() - startedAt }
      const { size } = await Promise.race([response.blob(), timedOut])
      return { ok: true, bytes: size, elapsedMs: clock() - startedAt }
    } finally {
      clearTimeout(timer)
    }
  }
