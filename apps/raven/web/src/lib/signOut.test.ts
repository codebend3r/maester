import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { AuthApiError } from '@supabase/supabase-js'
import { QueryClient } from '@tanstack/react-query'
import { AUTH_COOKIE } from '@raven/core'
import { createAuthClient } from '@/lib/authClient'
import { signOut } from '@/lib/signOut'
import { useAuthSession } from '@/stores/authSession'
import { createSelectionStore } from '@/stores/selection'
import { useSelectionScopes } from '@/stores/selectionScope'
import { useUnlockPrompt } from '@/stores/unlockPrompt'
import { answer, clearCookies, heldCookies, readyConfig, sessionOf } from '@/test/authCookies'
import { fakeAuthClient } from '@/test/authClient'

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
