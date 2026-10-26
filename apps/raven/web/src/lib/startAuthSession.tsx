import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect } from 'react'
import { AUTH_CONFIG_STATES } from '@raven/core'
import { authConfigQuery } from '@/lib/queries'
import { useAuthSession } from '@/stores/authSession'

type StartAuthSessionProps = { children: ReactNode }

/**
 * Starts the session store once the server says accounts are on, and not
 * before: with accounts off raven never builds an auth client. It watches the
 * config rather than reading it once, so a "try again" that finally reaches
 * the server still starts the session.
 */
export const StartAuthSession = ({ children }: StartAuthSessionProps) => {
  const config = useQuery(authConfigQuery).data
  const start = useAuthSession((state) => state.start)
  useEffect(() => {
    if (config?.state !== AUTH_CONFIG_STATES.ready) return
    start({ config })
  }, [config, start])
  return children
}
