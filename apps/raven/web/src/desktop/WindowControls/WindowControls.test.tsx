import { DESKTOP_PLATFORMS, DESKTOP_REQUESTS, WINDOW_ACTIONS } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WindowControls } from '@/desktop/WindowControls/WindowControls'
import { useWindowChrome } from '@/stores/windowChrome'
import { asPlayingDesktop, fakeClient } from '@/test/desktop'

describe('WindowControls', () => {
  it('draws nothing where macOS draws the controls', () => {
    asPlayingDesktop({ client: fakeClient({ platform: DESKTOP_PLATFORMS.mac }) })
    render(<WindowControls />)
    expect(screen.queryByRole('navigation', { name: 'Window' })).toBeNull()
  })

  it('asks main to minimize, maximize and close a window the page draws the controls of', async () => {
    const client = fakeClient({ platform: DESKTOP_PLATFORMS.windows })
    asPlayingDesktop({ client })
    render(<WindowControls />)
    await userEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    await userEvent.click(screen.getByRole('button', { name: 'Maximize or restore' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(client.request.mock.calls.map(([request]) => request)).toEqual([
      { type: DESKTOP_REQUESTS.windowControl, action: WINDOW_ACTIONS.minimize },
      { type: DESKTOP_REQUESTS.windowControl, action: WINDOW_ACTIONS.maximize },
      { type: DESKTOP_REQUESTS.windowControl, action: WINDOW_ACTIONS.close },
    ])
  })

  it("hides with the player's own controls and comes back with them", () => {
    asPlayingDesktop({ client: fakeClient({ platform: DESKTOP_PLATFORMS.windows }) })
    render(<WindowControls />)
    const controls = screen.getByRole('navigation', { name: 'Window' })
    act(() => useWindowChrome.getState().setShown(false))
    expect(controls.className).toContain('hidden')
    act(() => useWindowChrome.getState().setShown(true))
    expect(controls.className).not.toContain('hidden')
  })
})
