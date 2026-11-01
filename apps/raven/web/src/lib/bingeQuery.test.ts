import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { ApiError } from '@raven/core'
import { createQueryClient, queryKeys, useUnlockPrompt } from '@raven/ui/headless'
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

  it('silently omits a locked card without changing interactive PIN behavior', async () => {
    item.mockRejectedValue(new ApiError({ status: 423, message: 'Locked' }))
    expect(await client.fetchQuery({ ...bingeQuery(4), retry: false })).toBeNull()
    expect(useUnlockPrompt.getState().open).toBe(false)
    expect(client.getQueryData(queryKeys.item(4))).toBeUndefined()
    await expect(client.fetchQuery({ ...itemQuery(4), retry: false })).rejects.toThrow('Locked')
    expect(useUnlockPrompt.getState().open).toBe(true)
  })
})
