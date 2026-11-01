import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { ApiError } from '@raven/core'
import { createQueryClient, queryKeys } from '@raven/ui/headless'
import { api } from '@/lib/api'
import { bingeQuery } from '@/lib/bingeQuery'
import { itemQuery } from '@/lib/queries'

describe('passive binge queries', () => {
  const item = spyOn(api, 'getItem')
  const client = createQueryClient()
  afterEach(() => {
    client.clear()
    item.mockReset()
  })

  it('silently omits a locked card, and no read of a locked item opens a prompt', async () => {
    item.mockRejectedValue(new ApiError({ status: 423, message: 'Locked' }))
    expect(await client.fetchQuery({ ...bingeQuery(4), retry: false })).toBeNull()
    expect(client.getQueryData(queryKeys.item(4))).toBeUndefined()
    await expect(client.fetchQuery({ ...itemQuery(4), retry: false })).rejects.toThrow('Locked')
  })
})
