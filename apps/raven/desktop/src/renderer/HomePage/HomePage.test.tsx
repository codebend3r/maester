import { describe, expect, it } from 'bun:test'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DOWNLOADS_KEY } from '@/renderer/desktop/downloadsApi'
import { watchedLabel } from '@/renderer/HomePage/HomePage'
import { DL_1, DL_2, DL_3, DL_4, DL_5, viewOf } from '@/renderer/test/downloadFakes'
import { fakeClient, renderDesktop, STUB_ROUTES } from '@/renderer/test/render'
import { DESKTOP_REQUESTS, type DesktopReply, type DesktopRequest } from '@/shared/protocol'

const ID_A = '11111111-1111-4111-8111-111111111111'
const RECENT_1 = '44444444-4444-4444-8444-444444444444'
const RECENT_2 = '55555555-5555-4555-8555-555555555555'

const RECENTS = [
  { recentId: RECENT_1, label: 'Clip 01', from: 'Clips', watched: 0.5 },
  { recentId: RECENT_2, label: 'Clip 02', from: 'Clips', watched: null },
]

const answering =
  ({
    recents,
    others = {},
  }: {
    recents: typeof RECENTS
    others?: Partial<Record<string, DesktopReply>>
  }) =>
  async (request: DesktopRequest): Promise<DesktopReply> =>
    others[request.type] ??
    (request.type === DESKTOP_REQUESTS.listRecents
      ? { type: 'recents', recents }
      : { type: 'done' })

const settled = () => screen.findByText('Nothing opened yet.')

const dragOverWindow = ({ type, types }: { type: 'dragenter' | 'dragleave'; types: string[] }) => {
  const event = new Event(type)
  Object.defineProperty(event, 'dataTransfer', { value: { types } })
  act(() => {
    window.dispatchEvent(event)
  })
}

describe('HomePage', () => {
  it('focuses its heading on arrival', async () => {
    renderDesktop({ client: fakeClient(), routes: STUB_ROUTES })
    await settled()
    expect(screen.getByRole('heading', { name: 'raven player' })).toHaveFocus()
  })

  it('opens the dialog and plays what it picks', async () => {
    const client = fakeClient({
      request: answering({
        recents: [],
        others: { openDialog: { type: 'play', target: { fileId: ID_A, queue: [] } } },
      }),
    })
    const { router } = renderDesktop({ client, routes: STUB_ROUTES })
    await userEvent.click(screen.getByRole('button', { name: 'Choose a video' }))
    expect(client.request).toHaveBeenCalledWith({ type: 'openDialog' })
    await waitFor(() => expect(router.state.location.pathname).toBe(`/play/${ID_A}`))
  })

  it('lists the recents with how much of each was watched', async () => {
    renderDesktop({
      client: fakeClient({ request: answering({ recents: RECENTS }) }),
      routes: STUB_ROUTES,
    })
    expect(await screen.findByRole('button', { name: /Clip 01/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Clip 02/ })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '50% watched' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Not started' })).toBeInTheDocument()
  })

  it('opens a recent by its id', async () => {
    const client = fakeClient({
      request: answering({
        recents: RECENTS,
        others: { openRecent: { type: 'play', target: { fileId: ID_A, queue: [] } } },
      }),
    })
    const { router } = renderDesktop({ client, routes: STUB_ROUTES })
    await userEvent.click(await screen.findByRole('button', { name: /Clip 01/ }))
    expect(client.request).toHaveBeenCalledWith({ type: 'openRecent', recentId: RECENT_1 })
    await waitFor(() => expect(router.state.location.pathname).toBe(`/play/${ID_A}`))
  })

  it('removes a recent and refetches the list', async () => {
    const client = fakeClient({ request: answering({ recents: RECENTS }) })
    renderDesktop({ client, routes: STUB_ROUTES })
    const row = (await screen.findByRole('button', { name: /Clip 01/ })).closest('li')
    if (row === null) throw new Error('the recent has no row')
    await userEvent.click(within(row).getByRole('button', { name: 'Remove from recents' }))
    expect(client.request).toHaveBeenCalledWith({ type: 'removeRecent', recentId: RECENT_1 })
    await waitFor(() =>
      expect(
        client.request.mock.calls.filter(
          ([request]) => request.type === DESKTOP_REQUESTS.listRecents,
        ),
      ).toHaveLength(2),
    )
  })

  it('says so when nothing was opened yet', async () => {
    renderDesktop({
      client: fakeClient({ request: answering({ recents: [] }) }),
      routes: STUB_ROUTES,
    })
    expect(await screen.findByText('Nothing opened yet.')).toBeInTheDocument()
  })

  it('shows why the recents could not be listed', async () => {
    const client = fakeClient({
      request: async () => ({ type: 'refused', message: 'The state file is unreadable.' }),
    })
    renderDesktop({ client, routes: STUB_ROUTES })
    expect(await screen.findByRole('alert')).toHaveTextContent('The state file is unreadable.')
  })

  it('shows Drop to play while a drag is over the window', async () => {
    renderDesktop({ client: fakeClient(), routes: STUB_ROUTES })
    await settled()
    expect(screen.queryByText('Drop to play')).not.toBeInTheDocument()
    dragOverWindow({ type: 'dragenter', types: ['Files'] })
    expect(screen.getByText('Drop to play')).toBeInTheDocument()
    dragOverWindow({ type: 'dragleave', types: ['Files'] })
    expect(screen.queryByText('Drop to play')).not.toBeInTheDocument()
  })

  it('keeps Drop to play up while the drag moves between child elements', async () => {
    renderDesktop({ client: fakeClient(), routes: STUB_ROUTES })
    await settled()
    dragOverWindow({ type: 'dragenter', types: ['Files'] })
    dragOverWindow({ type: 'dragenter', types: ['Files'] })
    dragOverWindow({ type: 'dragleave', types: ['Files'] })
    expect(screen.getByText('Drop to play')).toBeInTheDocument()
  })

  it('ignores a drag of selected text', async () => {
    renderDesktop({ client: fakeClient(), routes: STUB_ROUTES })
    await settled()
    dragOverWindow({ type: 'dragenter', types: ['text/plain'] })
    expect(screen.queryByText('Drop to play')).not.toBeInTheDocument()
  })

  it('goes to Settings', async () => {
    const { router } = renderDesktop({ client: fakeClient(), routes: STUB_ROUTES })
    await settled()
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(router.state.location.pathname).toBe('/settings')
  })

  it('goes to Downloads', async () => {
    const { router } = renderDesktop({ client: fakeClient(), routes: STUB_ROUTES })
    await settled()
    await userEvent.click(screen.getByRole('button', { name: 'Downloads' }))
    expect(router.state.location.pathname).toBe('/downloads')
    expect(await screen.findByText('Downloads page')).toBeInTheDocument()
  })

  it('counts what is queued or downloading on the Downloads button', async () => {
    const downloads = [
      viewOf({ downloadId: DL_1, status: { kind: 'downloading', bytes: 1 } }),
      viewOf({ downloadId: DL_2, status: { kind: 'queued' } }),
      viewOf({ downloadId: DL_3, status: { kind: 'queued' } }),
      viewOf({ downloadId: DL_4, status: { kind: 'paused', bytes: 0, message: null } }),
      viewOf({ downloadId: DL_5, status: { kind: 'ready' } }),
    ]
    renderDesktop({
      client: fakeClient({
        request: answering({
          recents: [],
          others: { listDownloads: { type: 'downloads', downloads, autoDeleteDefault: false } },
        }),
      }),
      routes: STUB_ROUTES,
    })
    expect(
      await screen.findByRole('button', { name: 'Downloads, 3 in progress' }),
    ).toBeInTheDocument()
    expect(screen.getByText('3')).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows no count while nothing is in progress', async () => {
    const { queryClient } = renderDesktop({
      client: fakeClient({
        request: answering({
          recents: [],
          others: {
            listDownloads: {
              type: 'downloads',
              downloads: [viewOf({ status: { kind: 'ready' } })],
              autoDeleteDefault: false,
            },
          },
        }),
      }),
      routes: STUB_ROUTES,
    })
    await waitFor(() => expect(queryClient.getQueryData(DOWNLOADS_KEY)).toBeDefined())
    expect(screen.getByRole('button', { name: 'Downloads' })).toBeInTheDocument()
    expect(screen.queryByText('0')).toBeNull()
  })

  it('keeps the count as main pushes the downloads', async () => {
    const client = fakeClient()
    renderDesktop({ client, routes: STUB_ROUTES })
    await settled()
    await client.emit({
      type: 'downloads',
      downloads: [viewOf({ status: { kind: 'queued' } })],
      autoDeleteDefault: false,
    })
    expect(
      await screen.findByRole('button', { name: 'Downloads, 1 in progress' }),
    ).toBeInTheDocument()
  })
})

describe('watchedLabel', () => {
  it('rounds the share to a percent', () => {
    expect(watchedLabel(0.333)).toBe('33% watched')
  })

  it('says Not started when there is no share', () => {
    expect(watchedLabel(null)).toBe('Not started')
  })
})
