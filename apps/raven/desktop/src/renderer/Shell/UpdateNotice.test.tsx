import { describe, expect, it, mock } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UpdateNotice } from '@/renderer/Shell/UpdateNotice'
import { fakeClient, renderDesktop } from '@/renderer/test/render'

const renderNotice = async () => {
  const client = fakeClient()
  const onClose = mock(() => undefined)
  renderDesktop({
    client,
    routes: [{ path: '/', element: <UpdateNotice version="0.6.0" onClose={onClose} /> }],
  })
  const notice = await screen.findByRole('complementary', { name: 'Update' })
  return { client, onClose, notice }
}

describe('UpdateNotice', () => {
  it('says which release is out in an aside labelled Update', async () => {
    const { notice } = await renderNotice()
    expect(notice.tagName).toBe('ASIDE')
    expect(within(notice).getByText('raven player 0.6.0 is out.')).toBeInTheDocument()
  })

  it("opens the release page through main, then closes, on See what's new", async () => {
    const { notice, client, onClose } = await renderNotice()
    await userEvent.click(within(notice).getByRole('button', { name: "See what's new" }))
    expect(client.request).toHaveBeenCalledWith({ type: 'openRelease' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('closes on Dismiss and sends nothing', async () => {
    const { notice, client, onClose } = await renderNotice()
    await userEvent.click(within(notice).getByRole('button', { name: 'Dismiss' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(client.request).not.toHaveBeenCalled()
  })
})
