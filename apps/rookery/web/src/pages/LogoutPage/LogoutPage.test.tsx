import { describe, expect, it, spyOn } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { API_ROUTES, HTTP_METHODS } from '@/lib/api'
import { browser } from '@/lib/browser'
import { LogoutPage } from '@/pages/LogoutPage/LogoutPage'
import { renderAt } from '@/test/render'

describe('LogoutPage', () => {
  it('signs out and goes where the server says', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ next: 'https://sparrow.example.com/' }), { status: 200 }),
    )
    const goTo = spyOn(browser, 'goTo').mockImplementation(() => {})
    renderAt({ ui: <LogoutPage />, route: '/?return_to=https%3A%2F%2Fsparrow.example.com%2F' })

    await waitFor(() => expect(goTo).toHaveBeenCalledWith('https://sparrow.example.com/'))
    const [url, init = {}] = fetch.mock.calls[0] ?? []
    expect(url).toBe(API_ROUTES.logout)
    expect(init.method).toBe(HTTP_METHODS.post)
    expect(init.body).toBe(JSON.stringify({ return_to: 'https://sparrow.example.com/' }))
  })

  it('says so when the sign-out fails', async () => {
    spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'))
    const goTo = spyOn(browser, 'goTo').mockImplementation(() => {})
    renderAt({ ui: <LogoutPage /> })

    expect(await screen.findByRole('alert')).toHaveTextContent('could not sign you out')
    expect(goTo).not.toHaveBeenCalled()
  })
})
