import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeClient, renderDesktop } from '@/renderer/test/render'
import { DESKTOP_REQUESTS } from '@/shared/protocol'

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

  it('keeps its status region mounted, empty until there is something to say', async () => {
    renderDesktop({ client: fakeClient(), route: '/settings' })
    const recents = await screen.findByRole('region', { name: 'Recents' })
    expect(within(recents).getByRole('status')).toHaveTextContent('')
  })

  it('empties the status on each click, so a second clear is announced again', async () => {
    const replies: Array<(reply: { type: 'done' }) => void> = []
    const client = fakeClient({
      request: async (asked) => {
        if (asked.type === DESKTOP_REQUESTS.listRecents) return { type: 'recents', recents: [] }
        if (asked.type !== DESKTOP_REQUESTS.clearRecents) return { type: 'done' }
        const reply = Promise.withResolvers<{ type: 'done' }>()
        replies.push(reply.resolve)
        return reply.promise
      },
    })
    renderDesktop({ client, route: '/settings' })
    const recents = await screen.findByRole('region', { name: 'Recents' })
    const status = within(recents).getByRole('status')
    const button = within(recents).getByRole('button', { name: 'Clear recents' })
    await userEvent.click(button)
    replies.shift()!({ type: 'done' })
    await waitFor(() => expect(status).toHaveTextContent('Recents cleared.'))
    await userEvent.click(button)
    expect(status).toHaveTextContent('')
    replies.shift()!({ type: 'done' })
    await waitFor(() => expect(status).toHaveTextContent('Recents cleared.'))
  })

  it('says why when main refuses to clear', async () => {
    const client = fakeClient({
      request: async (asked) =>
        asked.type === DESKTOP_REQUESTS.clearRecents
          ? { type: 'refused', message: 'raven player could not do that. Try again.' }
          : { type: 'recents', recents: [] },
    })
    renderDesktop({ client, route: '/settings' })
    const recents = await screen.findByRole('region', { name: 'Recents' })
    await userEvent.click(within(recents).getByRole('button', { name: 'Clear recents' }))
    await waitFor(() =>
      expect(within(recents).getByRole('status')).toHaveTextContent(
        'raven player could not do that. Try again.',
      ),
    )
  })

  it('goes back Home', async () => {
    const { router } = renderDesktop({ client: fakeClient(), route: '/settings' })
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})
