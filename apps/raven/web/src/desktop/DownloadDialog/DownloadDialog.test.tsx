import { describe, expect, it, mock, spyOn } from 'bun:test'
import {
  AUTH_ROUTES,
  DESKTOP_PLATFORMS,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  DOWNLOAD_ASK_KINDS,
  type DownloadAsk,
  DOWNLOAD_KINDS,
  KEYS,
} from '@raven/core'
import { Toaster } from '@raven/ui'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { DownloadDialog } from '@/desktop/DownloadDialog/DownloadDialog'
import { api } from '@/lib/api'
import { useDownloadAsk } from '@/stores/downloadAsk'
import { Where, where } from '@/test/authPage'
import {
  ASK_ID,
  asDesktop,
  fakeClient,
  type FakeClient,
  GB,
  SERVER_ID,
  sentOfType,
} from '@/test/desktop'
import { renderWithProviders } from '@/test/render'

const askOf = (status: DownloadAsk['status']): DownloadAsk => ({
  askId: ASK_ID,
  serverId: SERVER_ID,
  serverName: 'raven',
  shouldAutoDelete: false,
  status,
})

const readyOf = (
  overrides: Partial<
    Extract<DownloadAsk['status'], { kind: typeof DOWNLOAD_ASK_KINDS.ready }>
  > = {},
) =>
  askOf({
    kind: DOWNLOAD_ASK_KINDS.ready,
    title: 'Severance',
    downloadKind: DOWNLOAD_KINDS.season,
    files: 9,
    bytes: 18 * GB,
    free: 400 * GB,
    canFit: true,
    ...overrides,
  })

type RenderDialogProps = {
  ask: DownloadAsk
  client?: FakeClient
}

const renderDialog = ({ ask, client = fakeClient() }: RenderDialogProps) => {
  asDesktop(client)
  const onClose = mock(() => undefined)
  renderWithProviders({
    route: '/shows/4',
    ui: (
      <>
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
        <Toaster />
        <DownloadDialog ask={ask} onClose={onClose} />
      </>
    ),
  })
  return { client, onClose }
}

describe('DownloadDialog', () => {
  it('says the room left on this PC on Windows', () => {
    renderDialog({ ask: readyOf(), client: fakeClient({ platform: DESKTOP_PLATFORMS.windows }) })
    expect(screen.getByText('400.0 GB free on this PC.')).toBeInTheDocument()
  })

  it('asks before downloading, with the room it takes, and downloads as chosen', async () => {
    const { client, onClose } = renderDialog({ ask: readyOf() })
    expect(screen.getByText('Download Severance (9 episodes, 18.0 GB)?')).toBeInTheDocument()
    expect(screen.getByText('400.0 GB free on this Mac.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Delete once watched' }))
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.confirmDownload })).toEqual([
      { type: DESKTOP_REQUESTS.confirmDownload, askId: ASK_ID, shouldAutoDelete: true },
    ])
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.declineDownload })).toEqual([])
  })

  it("says main's refusal of the download", async () => {
    const client = fakeClient({
      request: async () => ({ type: DESKTOP_REPLIES.refused, message: 'The disk is full.' }),
    })
    renderDialog({
      ask: readyOf({ files: 1, downloadKind: DOWNLOAD_KINDS.movie, title: 'Dune' }),
      client,
    })
    expect(screen.getByText('Download Dune (1 movie, 18.0 GB)?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(await screen.findByText('The disk is full.')).toBeInTheDocument()
  })

  it('offers no download that does not fit, or one already made, and declines on the way out', async () => {
    const { client } = renderDialog({ ask: readyOf({ canFit: false, free: 2 * GB }) })
    expect(screen.getByText('Needs 18.0 GB; 2.0 GB free.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(sentOfType({ client, type: DESKTOP_REQUESTS.declineDownload })).toEqual([
        { type: DESKTOP_REQUESTS.declineDownload, askId: ASK_ID },
      ]),
    )
  })

  it('says a title is already downloaded, and closes on Escape', async () => {
    const { onClose } = renderDialog({
      ask: readyOf({ files: 0, downloadKind: DOWNLOAD_KINDS.saga }),
    })
    expect(screen.getByText('Severance is already downloaded.')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: KEYS.escape })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('asks for the PIN of a locked title, then asks main again', async () => {
    const unlock = spyOn(api, 'unlock').mockResolvedValue({ available: true, unlocked: true })
    const again = readyOf()
    const client = fakeClient({
      request: async (request) =>
        request.type === DESKTOP_REQUESTS.retryDownloadAsk
          ? { type: DESKTOP_REPLIES.downloadAsk, ask: again }
          : { type: DESKTOP_REPLIES.done },
    })
    renderDialog({ ask: askOf({ kind: DOWNLOAD_ASK_KINDS.locked }), client })
    await userEvent.type(await screen.findByLabelText('PIN'), '3001')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitFor(() => expect(useDownloadAsk.getState().shown?.ask).toEqual(again))
    expect(unlock).toHaveBeenCalledWith('3001')
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.retryDownloadAsk })).toEqual([
      { type: DESKTOP_REQUESTS.retryDownloadAsk, askId: ASK_ID },
    ])
    unlock.mockRestore()
  })

  it('closes the PIN step once main has nothing more to ask, and declines a cancelled one', async () => {
    const unlock = spyOn(api, 'unlock').mockResolvedValue({ available: true, unlocked: true })
    const first = renderDialog({ ask: askOf({ kind: DOWNLOAD_ASK_KINDS.locked }) })
    await userEvent.type(await screen.findByLabelText('PIN'), '3001')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitFor(() => expect(first.onClose).toHaveBeenCalled())
    unlock.mockRestore()
  })

  it('declines a PIN step that is cancelled', async () => {
    const { client, onClose } = renderDialog({ ask: askOf({ kind: DOWNLOAD_ASK_KINDS.locked }) })
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.declineDownload })).toHaveLength(1)
  })

  it('sends a signed out page to sign in, back to where it was', async () => {
    const { client } = renderDialog({ ask: askOf({ kind: DOWNLOAD_ASK_KINDS.account }) })
    expect(
      screen.getByText('Sign in to raven to download from it, then download again.'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(where()).toStartWith(AUTH_ROUTES.signIn))
    expect(where()).toContain(encodeURIComponent('/shows/4'))
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.declineDownload })).toHaveLength(1)
  })
})
