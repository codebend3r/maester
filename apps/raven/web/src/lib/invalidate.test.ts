import { describe, expect, it } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { afterWatched, afterWatching } from '@/lib/invalidate'
import { queryKeys } from '@/lib/queryClient'

/** A client holding one query under each key, none of them stale. */
const holding = (keys: ReadonlyArray<readonly unknown[]>): QueryClient => {
  const client = new QueryClient()
  keys.forEach((key) => client.setQueryData(key, []))
  return client
}

const staleOf = ({
  client,
  keys,
}: {
  client: QueryClient
  keys: ReadonlyArray<readonly unknown[]>
}): boolean[] => keys.map((key) => !!client.getQueryState(key)?.isInvalidated)

describe('afterWatched', () => {
  it('reads every library, items, home, favourites and media again', async () => {
    const keys = [
      queryKeys.library(2),
      queryKeys.library(3),
      queryKeys.libraries,
      queryKeys.item(40),
      queryKeys.home,
      queryKeys.favourites,
      queryKeys.mediaItem(7),
      queryKeys.browse(null),
    ]
    const client = holding(keys)
    await afterWatched(client)
    expect(staleOf({ client, keys })).toEqual([true, true, true, true, true, true, true, false])
  })
})

describe('afterWatching', () => {
  it('reads the library, home, items and favourites again, and no other library', async () => {
    const keys = [
      queryKeys.library(2),
      queryKeys.home,
      queryKeys.item(40),
      queryKeys.favourites,
      queryKeys.library(3),
    ]
    const client = holding(keys)
    await afterWatching({ queryClient: client, libraryId: 2 })
    expect(staleOf({ client, keys })).toEqual([true, true, true, true, false])
  })
})
