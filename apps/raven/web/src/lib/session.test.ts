import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { AuthApiError } from '@supabase/supabase-js'
import { QueryClient } from '@tanstack/react-query'
import { AUTH_COOKIE } from '@raven/core'
import { type AuthClient, createAuthClient } from '@/lib/authClient'
import { callAuth, resendConfirmation, signOut } from '@/lib/session'
import { useAuthSession } from '@/stores/authSession'
import { useSelectionScopes } from '@/stores/selectionScope'
import { createSelectionStore, useUnlockPrompt } from '@raven/ui/headless'
import { fakeAuthClient, readyConfig } from '@/test/authClient'
import { answer, clearCookies, heldCookies, sessionOf } from '@/test/authCookies'

const credentials = { email: 'a@example.com', password: 'password' }

const accountState = () => {
  const queryClient = new QueryClient()
  queryClient.setQueryData(['libraries'], [{ id: 1 }])
  useUnlockPrompt.getState().ask()
  const store = createSelectionStore()
  store.getState().start('card-1')
  useSelectionScopes.setState({
    scopes: [{ resolve: () => [], allKeys: () => [], store, selectButton: { current: null } }],
  })
  return { queryClient, store }
}

afterEach(() => {
  clearCookies()
  spyOn(globalThis, 'fetch').mockRestore()
})

describe('callAuth', () => {
  it('refuses before the session has built its client', async () => {
    await expect(callAuth(async () => ({ error: null }))).rejects.toThrow(
      'Accounts are not ready yet',
    )
  })

  it('throws the error Supabase answers with, and returns any other answer', async () => {
    useAuthSession.setState({ client: fakeAuthClient().client })
    const refusal = new AuthApiError('Refused', 400, 'invalid_credentials')

    await expect(callAuth(async () => ({ error: refusal }))).rejects.toBe(refusal)
    expect(await callAuth(async () => ({ data: 1, error: null }))).toEqual({ data: 1, error: null })
  })
})

describe('resendConfirmation', () => {
  it('sends the confirmation email again as a sign up resend', async () => {
    const resend = mock(async (_params: Parameters<AuthClient['resend']>[0]) => ({
      data: { user: null, session: null },
      error: null,
    }))
    useAuthSession.setState({ client: fakeAuthClient({ calls: { resend } }).client })

    await resendConfirmation({ email: 'a@example.com' })

    expect(resend).toHaveBeenCalledWith({ type: 'signup', email: 'a@example.com' })
  })
})

describe('signOut', () => {
  it('signs out of Supabase, then empties the cache, closes the PIN prompt and clears selection', async () => {
    const fake = fakeAuthClient({ calls: { signOut: async () => ({ error: null }) } })
    useAuthSession.setState({ client: fake.client })
    const { queryClient, store } = accountState()

    await signOut({ queryClient })

    expect(queryClient.getQueryData(['libraries'])).toBeUndefined()
    expect(useUnlockPrompt.getState().open).toBe(false)
    expect(store.getState().selecting).toBe(false)
    expect(store.getState().keys.size).toBe(0)
  })

  it('still empties everything when the session store has no client', async () => {
    const { queryClient } = accountState()

    await signOut({ queryClient })

    expect(queryClient.getQueryData(['libraries'])).toBeUndefined()
    expect(useUnlockPrompt.getState().open).toBe(false)
  })

  it('ends the local session when Supabase cannot be reached', async () => {
    const scopes: unknown[] = []
    const fake = fakeAuthClient({
      calls: {
        signOut: async (options) => {
          scopes.push(options?.scope ?? 'global')
          return options?.scope === 'local'
            ? { error: null }
            : { error: new AuthApiError('offline', 500, undefined) }
        },
      },
    })
    useAuthSession.setState({ client: fake.client })
    const { queryClient } = accountState()

    await signOut({ queryClient })

    expect(scopes).toEqual(['global', 'local'])
    expect(queryClient.getQueryData(['libraries'])).toBeUndefined()
  })

  it('removes every chunk of a session that spans three cookies', async () => {
    answer({ body: sessionOf({ padding: 5000 }), status: 200 })
    const client = createAuthClient({ config: readyConfig })
    await client.signInWithPassword(credentials)
    expect(heldCookies().map((cookie) => cookie.name)).toEqual([
      `${AUTH_COOKIE}.0`,
      `${AUTH_COOKIE}.1`,
      `${AUTH_COOKIE}.2`,
    ])
    useAuthSession.setState({ client })

    await signOut({ queryClient: new QueryClient() })

    expect(heldCookies()).toEqual([])
  })
})
