import { useQuery } from '@tanstack/react-query'
import { AUTH_CONFIG_STATES } from '@raven/core'
import { confirmUrl } from '@/lib/authRoutes'
import { authConfigQuery } from '@/lib/queries'

/** Where an email link should land, on the web address the server names for raven. */
export const useConfirmUrl = (): string => {
  const config = useQuery(authConfigQuery).data
  return confirmUrl({
    webUrl: config?.state === AUTH_CONFIG_STATES.ready ? config.webUrl : window.location.origin,
  })
}
