import { describe, expect, it, mock } from 'bun:test'
import { QueryClient, skipToken } from '@tanstack/react-query'
import { DEFAULT_ACCOUNT_PREFERENCES } from '@raven/core'
import {
  accountPreferencesQuery,
  accountServersQuery,
  libraryPinsQuery,
  serverNamesQuery,
} from '@/query/accountQueries'
import { afterServersChanged } from '@/query/invalidate'
import { queryKeys } from '@/query/queryClient'

const SERVER_ID = '30000000-0000-4000-8000-000000000001'

const client = {
  listServers: mock(async () => []),
  listPins: mock(async () => []),
  listServerNames: mock(async () => [{ serverId: SERVER_ID, name: 'Vhagar' }]),
  readPreferences: mock(async () => ({ showPinServers: false })),
}

describe('the account queries', () => {
  it('wait while no one is signed in, or there is no client', () => {
    expect(serverNamesQuery({ client, userId: null }).queryFn).toBe(skipToken)
    expect(accountPreferencesQuery({ client: null, userId: 'account-1' }).queryFn).toBe(skipToken)
    expect(accountServersQuery({ client: null, userId: 'account-1' }).queryFn).toBe(skipToken)
    expect(libraryPinsQuery({ client, userId: null }).queryFn).toBe(skipToken)
  })

  it("read the account's server names and preferences, the defaults standing until then", async () => {
    const queryClient = new QueryClient()
    expect(await queryClient.fetchQuery(serverNamesQuery({ client, userId: 'account-1' }))).toEqual(
      [{ serverId: SERVER_ID, name: 'Vhagar' }],
    )
    const preferences = accountPreferencesQuery({ client, userId: 'account-1' })
    expect(preferences.placeholderData).toEqual(DEFAULT_ACCOUNT_PREFERENCES)
    expect(await queryClient.fetchQuery(preferences)).toEqual({ showPinServers: false })
  })

  it('read the names again when the servers change, and leave the preferences be', async () => {
    const queryClient = new QueryClient()
    const keys = [
      queryKeys.serverNames('account-1'),
      queryKeys.accountServers('account-1'),
      queryKeys.accountPreferences('account-1'),
    ]
    keys.forEach((key) => queryClient.setQueryData(key, []))
    const isStale = (index: number) =>
      queryClient.getQueryState(keys[index] ?? [])?.isInvalidated ?? false
    await afterServersChanged({ queryClient, userId: 'account-1' })
    expect([isStale(0), isStale(1), isStale(2)]).toEqual([true, true, false])
  })
})
