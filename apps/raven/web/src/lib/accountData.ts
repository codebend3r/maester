import { useQuery } from '@tanstack/react-query'
import { AUTH_CONFIG_STATES, type AccountDataClient, accountDataClientsFor } from '@raven/core'
import { authConfigQuery } from '@/lib/queries'
import { currentAccessToken, useAuthSession } from '@/stores/authSession'

/** The account database's client for the home server's Supabase project, made once for it. */
export const accountDataFor = accountDataClientsFor({
  accessToken: async () => currentAccessToken(),
  fetch: (url, init) => window.fetch(url, init),
})

/**
 * The account database's client and who it is for: null while accounts are off or the home
 * server's config is not read yet, and no one while nobody is signed in, which the account's
 * queries wait on.
 */
export const useAccountData = () => {
  const config = useQuery(authConfigQuery).data
  const userId = useAuthSession((state) => state.session?.userId ?? null)
  const isReady = !!config && config.state === AUTH_CONFIG_STATES.ready
  return { client: isReady ? accountDataFor(config) : null, userId, isConfigRead: !!config }
}

/** What a change to the account's own rows needs: its database, and who is signed in. */
export type AccountKeeping = { client: AccountDataClient; userId: string }

/** The account's database and who it is for, or null where nothing can be kept: accounts off, or no one signed in. */
export const useAccountKeeping = (): AccountKeeping | null => {
  const { client, userId } = useAccountData()
  return client === null || userId === null ? null : { client, userId }
}
