import { describe, expect, it } from 'bun:test'
import { MEMBER_STATUSES } from '@raven/core'
import { QueryClient } from '@tanstack/react-query'
import { waitFor } from '@testing-library/react'
import { ravenQueriesFor } from '@/query/ravenQueries'
import { useIsOwner } from '@/query/useIsOwner'
import { recordingApi } from '@/test/recordingApi'
import { renderQueryHook } from '@/test/renderQueryHook'

const USER_ID = '00000000-0000-4000-8000-000000000001'

type OwnerQueriesProps = { isOwner: boolean }

const ownerQueries = ({ isOwner }: OwnerQueriesProps) => {
  const { api, calls } = recordingApi({
    body: { id: USER_ID, email: 'a@b.c', status: MEMBER_STATUSES.approved, isOwner },
  })
  return { queries: ravenQueriesFor(api), calls }
}

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

describe('useIsOwner', () => {
  it("is true once the signed-in account's answer says it owns this raven", async () => {
    const { queries } = ownerQueries({ isOwner: true })
    const { result } = renderQueryHook({
      client: freshClient(),
      hook: () => useIsOwner({ queries, userId: USER_ID }),
    })

    expect(result.current).toBe(false)
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('stays false for a member', async () => {
    const { queries, calls } = ownerQueries({ isOwner: false })
    const { result } = renderQueryHook({
      client: freshClient(),
      hook: () => useIsOwner({ queries, userId: USER_ID }),
    })

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(result.current).toBe(false)
  })

  it('asks nothing and is false while no one is signed in', () => {
    const { queries, calls } = ownerQueries({ isOwner: true })
    const { result } = renderQueryHook({
      client: freshClient(),
      hook: () => useIsOwner({ queries, userId: null }),
    })

    expect(result.current).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
