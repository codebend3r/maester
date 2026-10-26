import { describe, expect, it, jest } from 'bun:test'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { playerQueryKeys } from '@raven/ui/headless'
import type { ReactNode } from 'react'
import { useTicketFollowsSession } from '@/lib/useTicketFollowsSession'
import { useAuthSession } from '@/stores/authSession'
import { SIGNED_IN } from '@/test/authClient'

const MEDIA_ID = 7

type SetUpProps = { isEnabled?: boolean }

/** Video 7's ticket query, as the player holds it, beside the hook; `isEnabled` false as before an origin is picked. */
const setUp = ({ isEnabled = true }: SetUpProps = {}) => {
  useAuthSession.setState({ session: SIGNED_IN })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const mint = jest.fn(async () => ({ ticket: 'account.ticket', expiresAt: Date.now() + 300_000 }))
  type WrapperProps = { children: ReactNode }

  const wrapper = ({ children }: WrapperProps) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  renderHook(
    () => {
      useQuery({
        queryKey: playerQueryKeys.mediaTicket(MEDIA_ID),
        queryFn: mint,
        staleTime: Infinity,
        enabled: isEnabled,
      })
      useTicketFollowsSession({ mediaId: MEDIA_ID })
    },
    { wrapper },
  )
  return { mint }
}

const refreshToken = (accessToken: string) =>
  act(() => useAuthSession.setState({ session: { ...SIGNED_IN, accessToken } }))

describe('useTicketFollowsSession', () => {
  it("mints a new ticket for the open title as soon as the session's token is refreshed", async () => {
    const { mint } = setUp()
    await waitFor(() => expect(mint).toHaveBeenCalledTimes(1))

    refreshToken('refreshed')
    await waitFor(() => expect(mint).toHaveBeenCalledTimes(2))
    refreshToken('refreshed again')
    await waitFor(() => expect(mint).toHaveBeenCalledTimes(3))
  })

  it('mints nothing when the session changes but its token does not, or when it signs out', async () => {
    const { mint } = setUp()
    await waitFor(() => expect(mint).toHaveBeenCalledTimes(1))

    act(() => useAuthSession.setState({ session: { ...SIGNED_IN } }))
    act(() => useAuthSession.setState({ session: null }))
    await act(() => Promise.resolve())
    expect(mint).toHaveBeenCalledTimes(1)
  })

  it('mints nothing for a player that has no media origin to use a ticket on', async () => {
    const { mint } = setUp({ isEnabled: false })
    refreshToken('refreshed')
    await act(() => Promise.resolve())
    expect(mint).not.toHaveBeenCalled()
  })
})
