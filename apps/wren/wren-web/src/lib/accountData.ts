import { AUTH_CONFIG_STATES, accountDataClientsFor } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { queries } from '@/lib/queries'
import { useAuthSession } from '@/stores/authSession'

/** The account database's client for raven's Supabase project, made once for it. */
export const accountDataFor = accountDataClientsFor({
  accessToken: async () => useAuthSession.getState().session?.accessToken ?? null,
  fetch: (url, init) => window.fetch(url, init),
})

/**
 * The account database's client, who it is for and raven's own id, which the account names it
 * by: the client is null while accounts are off or raven's config is not read yet, and no one
 * while nobody is signed in, which the account's queries wait on.
 */
export const useAccountData = () => {
  const config = useQuery(queries.authConfigQuery).data
  const userId = useAuthSession((state) => state.session?.userId ?? null)
  const client =
    config !== undefined && config.state === AUTH_CONFIG_STATES.ready
      ? accountDataFor(config)
      : null
  return { client, userId, serverId: config?.serverId ?? null }
}
