import { describe, expect, it, mock } from 'bun:test'
import { DESKTOP_REPLIES, DESKTOP_REQUESTS, PAGE_PATHS, KEYS } from '@raven/core'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { OpenLinkDialog } from '@/desktop/OpenLinkDialog/OpenLinkDialog'
import { Where, where } from '@/test/authPage'
import { asDesktop, fakeClient, type FakeClient, sentOfType } from '@/test/desktop'
import { renderWithProviders } from '@/test/render'

const LINK = 'http://localhost:8484/watch/7'

const renderDialog = (client: FakeClient) => {
  asDesktop(client)
  const onClose = mock(() => undefined)
  renderWithProviders({
    ui: (
      <>
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
        <OpenLinkDialog onClose={onClose} />
      </>
    ),
  })
  return { onClose }
}

describe('OpenLinkDialog', () => {
  it('opens a pasted link where main says, and closes', async () => {
    const client = fakeClient({
      request: async () => ({ type: DESKTOP_REPLIES.navigate, to: `${PAGE_PATHS.watch}/7` }),
    })
    const { onClose } = renderDialog(client)
    await userEvent.type(screen.getByLabelText('Link'), ` ${LINK} `)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(where()).toBe(`${PAGE_PATHS.watch}/7`))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.openLink })).toEqual([
      { type: DESKTOP_REQUESTS.openLink, link: LINK },
    ])
  })

  it("stays open with main's refusal, or its own words for an answer it cannot use", async () => {
    const replies = [
      {
        type: DESKTOP_REPLIES.refused,
        message: 'raven player opens links to its own server only.',
      },
      { type: DESKTOP_REPLIES.done },
    ] as const
    const client = fakeClient({
      request: async () => replies[client.request.mock.calls.length - 1] ?? replies[1],
    })
    renderDialog(client)
    await userEvent.type(screen.getByLabelText('Link'), LINK)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'raven player opens links to its own server only.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'raven player could not open that link. Try again.',
      ),
    )
  })

  it('closes on Escape without asking main', async () => {
    const client = fakeClient()
    const { onClose } = renderDialog(client)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: KEYS.escape })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(client.request).not.toHaveBeenCalled()
  })
})
