import { useEffect } from 'react'

import type { AccountSessionStore } from '@/account/accountSession'

/** How long before the access token ends a new one is asked for. */
const REFRESH_LEAD_MS = 60_000

type TokenRenewalForProps = { session: AccountSessionStore }

/**
 * The hook an app's root calls to renew its account's access token a minute before it ends, so
 * a call never meets an expired one. Made per store at module scope, since a store handed to a
 * hook at render reads to the hooks rule as a hook used as a value.
 */
export const tokenRenewalFor = ({ session }: TokenRenewalForProps) => {
  const useTokenRenewal = (): void => {
    const expiresAt = session((state) => state.session?.expiresAt ?? null)
    useEffect(() => {
      if (expiresAt === null) return undefined
      const timer = setTimeout(
        () => {
          session
            .getState()
            .refresh()
            .catch(() => undefined)
        },
        Math.max(0, expiresAt - Date.now() - REFRESH_LEAD_MS),
      )
      return () => clearTimeout(timer)
    }, [expiresAt])
  }
  return useTokenRenewal
}
