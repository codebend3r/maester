import { AUTH_CONFIG_STATES } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect } from 'react'
import { queries } from '@/lib/queries'
import { useAuthSession } from '@/stores/authSession'

type StartAuthSessionProps = { children: ReactNode }

/**
 * Starts the session store once the server says accounts are on, and not before: with accounts
 * off Wren never builds an auth client. It watches the config rather than reading it once, so a
 * retry that finally reaches the server still starts the session.
 */
export function StartAuthSession({ children }: StartAuthSessionProps) {
  const config = useQuery(queries.authConfigQuery).data
  const start = useAuthSession((state) => state.start)
  useEffect(() => {
    if (config == null || config.state !== AUTH_CONFIG_STATES.ready) return
    // The client's load answers null rather than rejecting; the catch only keeps the promise from floating.
    start({ config }).catch(() => undefined)
  }, [config, start])
  return children
}
