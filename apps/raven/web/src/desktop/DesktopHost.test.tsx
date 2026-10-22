import { describe, expect, it, spyOn } from 'bun:test'
import {
  AUTH_CONFIG_STATES,
  DESKTOP_EVENTS,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  DOWNLOAD_ASK_KINDS,
  type DownloadAsk,
  MENU_PLAYER_ACTIONS,
  PAGE_PATHS,
  DOWNLOAD_KINDS,
} from '@raven/core'
import { Toaster } from '@raven/ui'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { DesktopHost } from '@/desktop/DesktopHost'
import type { DownloadsData } from '@/desktop/downloadsApi'
import { DESKTOP_QUERY_KEYS } from '@/desktop/queryKeys'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { useDragging } from '@/stores/dragging'
import { SIGNED_IN } from '@/test/authClient'
import { Where, where } from '@/test/authPage'
import {
  ASK_ID,
  asDesktop,
  fakeClient,
  FILE_ID,
  type FakeClient,
  SERVER_ID,
  sentOfType,
  viewOf,
} from '@/test/desktop'
import { renderWithProviders } from '@/test/render'
import { playPathOf } from '@/desktop/paths'

const askOf = (status: DownloadAsk['status']): DownloadAsk => ({
  askId: ASK_ID,
  serverId: SERVER_ID,
  serverName: 'raven',
  shouldAutoDelete: false,
  status,
})

const READY_ASK = askOf({
  kind: DOWNLOAD_ASK_KINDS.ready,
  title: 'Dune (2021)',
  downloadKind: DOWNLOAD_KINDS.movie,
  files: 1,
  bytes: 4_000_000_000,
  free: 400_000_000_000,
  canFit: true,
})

const renderHost = ({
  client = fakeClient(),
  route = '/',
}: { client?: FakeClient; route?: string } = {}) => {
  const { menu } = asDesktop(client)
  const rendered = renderWithProviders({
    route,
    authConfig: { state: AUTH_CONFIG_STATES.off },
    ui: (
      <>
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
        <Toaster />
        <DesktopHost />
      </>
    ),
  })
  return { ...rendered, client, menu }
}

describe('DesktopHost', () => {
  it('says the page is ready once, and listens to main', () => {
    const { client } = renderHost()
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.ready })).toHaveLength(1)
    expect(client.subscribe).toHaveBeenCalledTimes(1)
  })

  it('goes where main sends it, and plays what it opens', async () => {
    const { client } = renderHost()
    await client.emit({ type: DESKTOP_EVENTS.navigate, to: PAGE_PATHS.settings })
    expect(where()).toBe(PAGE_PATHS.settings)
    await client.emit({ type: DESKTOP_EVENTS.play, target: { fileId: FILE_ID, queue: [] } })
    expect(where()).toBe(playPathOf(FILE_ID))
  })

  it("shows main's notices and a newer release as toasts", async () => {
    const { client } = renderHost()
    await client.emit({ type: DESKTOP_EVENTS.notice, message: 'That file is gone.' })
    await client.emit({ type: DESKTOP_EVENTS.updateAvailable, version: '2.0.0' })
    expect(screen.getByText('That file is gone.')).toBeInTheDocument()
    expect(
      screen.getByText("raven player 2.0.0 is out. Settings has what's new."),
    ).toBeInTheDocument()
  })

  it('hands the Playback menu to whoever plays', async () => {
    const { client, menu } = renderHost()
    const heard: string[] = []
    menu.subscribe((action) => heard.push(action))
    await client.emit({ type: DESKTOP_EVENTS.player, action: MENU_PLAYER_ACTIONS.togglePlay })
    expect(heard).toEqual([MENU_PLAYER_ACTIONS.togglePlay])
  })

  it('asks about a download main pushes, and declines it when cancelled', async () => {
    const { client } = renderHost()
    await client.emit({ type: DESKTOP_EVENTS.downloadAsk, ask: READY_ASK })
    expect(screen.getByRole('dialog', { name: 'Download to raven player' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.declineDownload })).toEqual([
      { type: DESKTOP_REQUESTS.declineDownload, askId: ASK_ID },
    ])
  })

  it('opens the Open Link dialog from the menu', async () => {
    const { client } = renderHost()
    await client.emit({ type: DESKTOP_EVENTS.openLink })
    expect(screen.getByRole('dialog', { name: 'Open a link' })).toBeInTheDocument()
  })

  it("hands main the page's account once it is read, again as it changes, and null on sign out", async () => {
    useAuthSession.setState({ status: AUTH_SESSION_STATUSES.booting, session: null })
    const { client } = renderHost()
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.accountToken })).toEqual([])
    act(() => useAuthSession.setState({ status: AUTH_SESSION_STATUSES.ready, session: SIGNED_IN }))
    act(() => useAuthSession.setState({ session: { ...SIGNED_IN, accessToken: 'renewed' } }))
    act(() => useAuthSession.setState({ isRecovery: true }))
    act(() => useAuthSession.setState({ session: null }))
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.accountToken })).toEqual([
      { type: DESKTOP_REQUESTS.accountToken, session: SIGNED_IN },
      { type: DESKTOP_REQUESTS.accountToken, session: { ...SIGNED_IN, accessToken: 'renewed' } },
      { type: DESKTOP_REQUESTS.accountToken, session: null },
    ])
  })

  it('sends the account already read as it mounts, and warns when main refuses it', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    useAuthSession.setState({ status: AUTH_SESSION_STATUSES.ready, session: SIGNED_IN })
    const client = fakeClient({
      request: async (request) =>
        request.type === DESKTOP_REQUESTS.accountToken
          ? { type: DESKTOP_REPLIES.refused, message: 'Not that account.' }
          : { type: DESKTOP_REPLIES.done },
    })
    renderHost({ client })
    expect(sentOfType({ client, type: DESKTOP_REQUESTS.accountToken })).toEqual([
      { type: DESKTOP_REQUESTS.accountToken, session: SIGNED_IN },
    ])
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1))
    warn.mockRestore()
  })

  it('plays files dropped on the window, and says while they are dragged over it', async () => {
    const client = fakeClient({
      dropFiles: async () => ({
        type: DESKTOP_REPLIES.play,
        target: { fileId: FILE_ID, queue: [] },
      }),
    })
    renderHost({ client })
    const files = { types: ['Files'], files: [] }
    fireEvent.dragEnter(window, { dataTransfer: files })
    expect(useDragging.getState().isDragging).toBe(true)
    fireEvent.dragLeave(window, { dataTransfer: files })
    expect(useDragging.getState().isDragging).toBe(false)
    fireEvent.dragEnter(window, { dataTransfer: { types: ['text/plain'], files: [] } })
    expect(useDragging.getState().isDragging).toBe(false)
    fireEvent.dragOver(window, { dataTransfer: files })
    await act(async () => {
      fireEvent.drop(window, { dataTransfer: files })
    })
    expect(where()).toBe(playPathOf(FILE_ID))
    expect(client.dropFiles).toHaveBeenCalledTimes(1)
  })
})

describe('DesktopHost and the downloads cache', () => {
  it('replaces the list main pushed', async () => {
    const client = fakeClient()
    const { client: queries } = renderHostWithCache(client)
    const view = viewOf()
    await client.emit({
      type: DESKTOP_EVENTS.downloads,
      downloads: [view],
      shouldAutoDeleteByDefault: true,
    })
    expect(queries.getQueryData<DownloadsData>(DESKTOP_QUERY_KEYS.downloads)).toEqual({
      downloads: [view],
      shouldAutoDelete: true,
    })
  })
})

const renderHostWithCache = (client: FakeClient) => {
  asDesktop(client)
  return renderWithProviders({
    authConfig: { state: AUTH_CONFIG_STATES.off },
    ui: <DesktopHost />,
  })
}
