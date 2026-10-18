import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { AUTH_CONFIG_STATES, AUTH_COOKIE } from '@raven/core'
import { StartAuthSession } from '@/lib/startAuthSession'
import { type AuthSessionStatus, useAuthSession } from '@/stores/authSession'
import { renderWithProviders } from '@/test/render'

const startSpy = () => {
  const calls: unknown[] = []
  useAuthSession.setState({ start: (options) => calls.push(options) })
  return calls
}

describe('StartAuthSession', () => {
  it('starts the session once accounts are on', async () => {
    const calls = startSpy()
    const config = {
      state: AUTH_CONFIG_STATES.ready,
      supabaseUrl: 'http://127.0.0.1:54321',
      publishableKey: 'sb_publishable_test',
      webUrl: 'http://localhost:8484',
      cookieName: AUTH_COOKIE,
    } as const
    renderWithProviders({
      authConfig: config,
      ui: (
        <StartAuthSession>
          <p>Inside</p>
        </StartAuthSession>
      ),
    })
    expect(screen.getByText('Inside')).toBeInTheDocument()
    await waitFor(() => expect(calls).toEqual([{ config }]))
  })

  it.each([AUTH_CONFIG_STATES.off, AUTH_CONFIG_STATES.unavailable])(
    'leaves the session unstarted while accounts are %s',
    (state) => {
      const calls = startSpy()
      renderWithProviders({
        authConfig: { state },
        ui: <StartAuthSession>{null}</StartAuthSession>,
      })
      expect(calls).toEqual([])
      const status: AuthSessionStatus = useAuthSession.getState().status
      expect(status).toBe('booting')
    },
  )
})
