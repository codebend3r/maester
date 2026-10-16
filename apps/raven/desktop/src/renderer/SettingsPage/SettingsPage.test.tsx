import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeClient, renderDesktop } from '@/renderer/test/render'

describe('SettingsPage', () => {
  it('focuses its heading on arrival', async () => {
    renderDesktop({ client: fakeClient(), route: '/settings' })
    expect(await screen.findByRole('heading', { name: 'Settings' })).toHaveFocus()
  })

  it('clears the recents and says so', async () => {
    const client = fakeClient()
    renderDesktop({ client, route: '/settings' })
    await userEvent.click(await screen.findByRole('button', { name: 'Clear recents' }))
    expect(client.request).toHaveBeenCalledWith({ type: 'clearRecents' })
    await screen.findByText('Recents cleared.')
    expect(screen.getByText('Recents cleared.').tagName).toBe('OUTPUT')
  })

  it('goes back Home', async () => {
    const { router } = renderDesktop({ client: fakeClient(), route: '/settings' })
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})
