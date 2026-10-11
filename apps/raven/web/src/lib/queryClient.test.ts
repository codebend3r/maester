import { describe, expect, it } from 'bun:test'
import { ApiError } from '@raven/core'
import { createQueryClient } from '@/lib/queryClient'
import { useUnlockPrompt } from '@/stores/unlockPrompt'

const failWith = (status: number) => async (): Promise<never> => {
  throw new ApiError({ status, message: 'No' })
}

describe('createQueryClient', () => {
  it('asks for the PIN when a call is refused for a locked library', async () => {
    const client = createQueryClient()
    await client
      .fetchQuery({ queryKey: ['other'], queryFn: failWith(404), retry: false })
      .catch(() => null)
    expect(useUnlockPrompt.getState().open).toBe(false)
    await client
      .fetchQuery({ queryKey: ['locked'], queryFn: failWith(423), retry: false })
      .catch(() => null)
    expect(useUnlockPrompt.getState().open).toBe(true)
  })
})
