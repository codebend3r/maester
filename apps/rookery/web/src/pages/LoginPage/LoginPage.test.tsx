import { describe, expect, it, spyOn } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { browser } from '@/lib/browser'
import { ERROR_MESSAGES, LoginPage } from '@/pages/LoginPage/LoginPage'
import { renderAt } from '@/test/render'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('LoginPage', () => {
  it.each(Object.entries(ERROR_MESSAGES))('explains error=%s', (code, message) => {
    renderAt(<LoginPage />, { route: `/?error=${code}` })
    expect(screen.getByRole('alert')).toHaveTextContent(message)
  })

  it('shows no message on a fresh visit', () => {
    renderAt(<LoginPage />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('starts a sign-in with return_to and goes to Plex', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ auth_url: 'https://app.plex.tv/auth#?code=abc' }),
    )
    const goTo = spyOn(browser, 'goTo').mockImplementation(() => {})
    renderAt(<LoginPage />, { route: '/?return_to=https%3A%2F%2Fluwin.example.com%2F' })

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Plex' }))

    await waitFor(() => expect(goTo).toHaveBeenCalledWith('https://app.plex.tv/auth#?code=abc'))
    const [url, init = {}] = fetch.mock.calls[0] ?? []
    expect(url).toBe('/api/auth/plex/start')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ return_to: 'https://luwin.example.com/' }))
  })

  it('says so when Plex is down, and lets the friend try again', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(json({ reason: 'plex_unavailable' }, 503))
    const goTo = spyOn(browser, 'goTo').mockImplementation(() => {})
    renderAt(<LoginPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Plex' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(ERROR_MESSAGES.plex_unavailable)
    expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toBeEnabled()
    expect(goTo).not.toHaveBeenCalled()
  })
})
