import { describe, expect, it } from 'bun:test'
import { QueryClient, type QueryKey } from '@tanstack/react-query'
import { authConfigQuery } from '@/lib/queries'
import { AUTH_CONFIG_KEY, keepAuthConfigSaved, restoreAuthConfig } from '@/lib/savedAuthConfig'
import { readyConfig } from '@/test/authClient'

const memoryStorage = (entries: Record<string, string> = {}) => {
  const values = new Map(Object.entries(entries))
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}

type DataOfProps = { client: QueryClient; queryKey: QueryKey }

/** What the cache holds under `queryKey`, untyped, so a test compares it with its fixture. */
const dataOf = ({ client, queryKey }: DataOfProps): unknown => client.getQueryData(queryKey)

describe('saved auth config', () => {
  it("puts the last config in the cache, stale, so the gate's first read asks the server again", () => {
    const storage = memoryStorage({ [AUTH_CONFIG_KEY]: JSON.stringify(readyConfig) })
    const client = new QueryClient()
    restoreAuthConfig({ storage, queryClient: client })
    expect(dataOf({ client, queryKey: authConfigQuery.queryKey })).toEqual(readyConfig)
    expect(client.getQueryState(authConfigQuery.queryKey)?.isInvalidated).toBe(true)
  })

  it('puts back nothing that is not a config', () => {
    const client = new QueryClient()
    restoreAuthConfig({
      storage: memoryStorage({ [AUTH_CONFIG_KEY]: '{"state":"maybe"}' }),
      queryClient: client,
    })
    restoreAuthConfig({
      storage: memoryStorage({ [AUTH_CONFIG_KEY]: 'not json' }),
      queryClient: client,
    })
    restoreAuthConfig({ storage: memoryStorage(), queryClient: client })
    expect(dataOf({ client, queryKey: authConfigQuery.queryKey })).toBeUndefined()
  })

  it("saves the server's answer and nothing else, until stopped", async () => {
    const storage = memoryStorage()
    const client = new QueryClient()
    const stop = keepAuthConfigSaved({ storage, queryClient: client })
    await client.fetchQuery({ queryKey: ['home'], queryFn: async () => 1 })
    expect(storage.values.size).toBe(0)
    await client.fetchQuery({
      queryKey: authConfigQuery.queryKey,
      queryFn: async () => readyConfig,
    })
    expect(JSON.parse(storage.values.get(AUTH_CONFIG_KEY) ?? 'null')).toEqual(readyConfig)
    stop()
    storage.values.clear()
    await client.refetchQueries({ queryKey: authConfigQuery.queryKey })
    expect(storage.values.size).toBe(0)
  })

  it('keeps going when storage refuses to save', async () => {
    const client = new QueryClient()
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    keepAuthConfigSaved({ storage: refusing, queryClient: client })
    await client.fetchQuery({
      queryKey: authConfigQuery.queryKey,
      queryFn: async () => readyConfig,
    })
    expect(dataOf({ client, queryKey: authConfigQuery.queryKey })).toEqual(readyConfig)
  })
})
