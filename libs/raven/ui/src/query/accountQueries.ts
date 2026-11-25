import { queryOptions, skipToken } from '@tanstack/react-query'
import {
  type AccountDataClient,
  type ApiClient,
  DEFAULT_ACCOUNT_PREFERENCES,
  type ServerId,
} from '@raven/core'
import { queryKeys } from '@/query/queryClient'

type AccountDataQueryProps<TRead extends keyof AccountDataClient> = {
  /** What reads the account database, or null while nothing does (accounts off, or not read yet). */
  client: Pick<AccountDataClient, TRead> | null
  /** Who is signed in; null while no one is, which the query waits on. */
  userId: string | null
}

/** The account's extra servers, from its own database; it waits while there is no client or no one signed in. */
export const accountServersQuery = ({ client, userId }: AccountDataQueryProps<'listServers'>) =>
  queryOptions({
    queryKey: queryKeys.accountServers(userId),
    queryFn: client === null || userId === null ? skipToken : () => client.listServers(),
  })

/** The names the account gave servers it keeps no row for: its home one. */
export const serverNamesQuery = ({ client, userId }: AccountDataQueryProps<'listServerNames'>) =>
  queryOptions({
    queryKey: queryKeys.serverNames(userId),
    queryFn: client === null || userId === null ? skipToken : () => client.listServerNames(),
  })

/** The account's choices; the defaults stand while there is no client or no one signed in. */
export const accountPreferencesQuery = ({
  client,
  userId,
}: AccountDataQueryProps<'readPreferences'>) =>
  queryOptions({
    queryKey: queryKeys.accountPreferences(userId),
    queryFn: client === null || userId === null ? skipToken : () => client.readPreferences(),
    placeholderData: DEFAULT_ACCOUNT_PREFERENCES,
  })

/** The libraries the account pinned, on every server, oldest pin first. */
export const libraryPinsQuery = ({ client, userId }: AccountDataQueryProps<'listPins'>) =>
  queryOptions({
    queryKey: queryKeys.libraryPins(userId),
    queryFn: client === null || userId === null ? skipToken : () => client.listPins(),
  })

/** How long another server's library list stands before the side menu asks it again. */
const SERVER_LIBRARIES_FRESH_MS = 5 * 60_000

type ServerLibrariesQueryProps = {
  serverId: ServerId
  /** What reads that server's library list: its client at its own origin, or a host's relay to it. */
  api: Pick<ApiClient, 'listLibraries'>
}

/**
 * Another server's libraries, for the names and types of the pins kept on it. A server that does
 * not answer is not asked again at once: its pins wait for the next read.
 */
export const serverLibrariesQuery = ({ serverId, api }: ServerLibrariesQueryProps) =>
  queryOptions({
    queryKey: queryKeys.serverLibraries(serverId),
    queryFn: () => api.listLibraries(),
    staleTime: SERVER_LIBRARIES_FRESH_MS,
    retry: false,
  })
