import { describe, expect, it, spyOn } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AUTH_ERRORS, CONTENT_TYPES, HEADERS, HTTP_METHODS } from '@/lib/api'
import { browser } from '@/lib/browser'
import { ERROR_MESSAGES, LoginPage } from '@/pages/LoginPage/LoginPage'
import { renderAt } from '@/test/render'

type JsonProps = { body: unknown; status?: number }

const json = ({ body, status = 200 }: JsonProps) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { [HEADERS.contentType]: CONTENT_TYPES.json },
  })

describe('LoginPage', () => {
  it.each(Object.entries(ERROR_MESSAGES))('explains error=%s', (code, message) => {
    renderAt({ ui: <LoginPage />, route: `/?error=${code}` })
    expect(screen.getByRole('alert')).toHaveTextContent(message)
  })

  it('reads an error code it does not know as unreachable', () => {
    renderAt({ ui: <LoginPage />, route: '/?error=made_up' })
    expect(screen.getByRole('alert')).toHaveTextContent(ERROR_MESSAGES[AUTH_ERRORS.unreachable])
  })

  it('shows no message on a fresh visit', () => {
    renderAt({ ui: <LoginPage /> })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('starts a sign-in with return_to and goes to Plex', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ body: { auth_url: 'https://app.plex.tv/auth#?code=abc' } }),
    )
    const goTo = spyOn(browser, 'goTo').mockImplementation(() => {})
    renderAt({ ui: <LoginPage />, route: '/?return_to=https%3A%2F%2Fluwin.example.com%2F' })

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Plex' }))

    await waitFor(() => expect(goTo).toHaveBeenCalledWith('https://app.plex.tv/auth#?code=abc'))
    const [url, init = {}] = fetch.mock.calls[0] ?? []
    expect(url).toBe('/api/auth/plex/start')
    expect(init.method).toBe(HTTP_METHODS.post)
    expect(new Headers(init.headers).get(HEADERS.contentType)).toBe(CONTENT_TYPES.json)
    expect(init.body).toBe(JSON.stringify({ return_to: 'https://luwin.example.com/' }))
  })

  it('says so when Plex is down, and lets the friend try again', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ body: { reason: AUTH_ERRORS.plexUnavailable }, status: 503 }),
    )
    const goTo = spyOn(browser, 'goTo').mockImplementation(() => {})
    renderAt({ ui: <LoginPage /> })

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Plex' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      ERROR_MESSAGES[AUTH_ERRORS.plexUnavailable],
    )
    expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toBeEnabled()
    expect(goTo).not.toHaveBeenCalled()
  })
})
