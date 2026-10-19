import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { AUTH_CONFIG_STATES } from '@raven/core'
import { StartAuthSession } from '@/lib/startAuthSession'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { readyConfig } from '@/test/authClient'
import { renderWithProviders } from '@/test/render'

const startSpy = () => {
  const calls: unknown[] = []
  useAuthSession.setState({ start: (options) => calls.push(options) })
  return calls
}

describe('StartAuthSession', () => {
  it('starts the session once accounts are on', async () => {
    const calls = startSpy()
    renderWithProviders({
      authConfig: readyConfig,
      ui: (
        <StartAuthSession>
          <p>Inside</p>
        </StartAuthSession>
      ),
    })
    expect(screen.getByText('Inside')).toBeInTheDocument()
    await waitFor(() => expect(calls).toEqual([{ config: readyConfig }]))
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
      expect(useAuthSession.getState().status).toBe(AUTH_SESSION_STATUSES.booting)
    },
  )
})
