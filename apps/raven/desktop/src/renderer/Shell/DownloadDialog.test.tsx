import { describe, expect, it } from 'bun:test'
import { formatBytes } from '@raven/core'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeClient, renderDesktop, STUB_ROUTES } from '@/renderer/test/render'
import { reply, S, sentOfType, serverClient } from '@/renderer/test/serverFakes'
import { SERVER_COPY } from '@/renderer/ServerPage/serverServices'
import type { DownloadAsk } from '@/shared/protocol'

const ASK = '44444444-4444-4444-8444-444444444444'

const GB = 1_000_000_000

const ready = (
  status: Partial<Extract<DownloadAsk['status'], { kind: 'ready' }>> = {},
): DownloadAsk => ({
  askId: ASK,
  serverId: S,
  serverName: 'Vhagar',
  autoDelete: false,
  status: {
    kind: 'ready',
    title: 'Dune',
    downloadKind: 'saga',
    files: 3,
    bytes: 41.2 * GB,
    free: 412 * GB,
    fits: true,
    ...status,
  },
})

/** The Shell over Home with `ask` pushed by main; the dialog it opens is returned. */
const openAsk = async ({
  ask,
  client = fakeClient(),
}: {
  ask: DownloadAsk
  client?: ReturnType<typeof fakeClient>
}) => {
  renderDesktop({ client, routes: STUB_ROUTES })
  await screen.findByText('Nothing opened yet.')
  await client.emit({ type: 'downloadAsk', ask })
  return client
}

describe('DownloadDialog', () => {
  it('asks what will be downloaded, from where, and how much room is left', async () => {
    await openAsk({ ask: ready() })
    const dialog = await screen.findByRole('dialog', { name: 'Download to raven player' })
    expect(
      within(dialog).getByText(`Download Dune (3 movies, ${formatBytes(41.2 * GB)}) from Vhagar?`),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(`${formatBytes(412 * GB)} free on this disk.`),
    ).toBeInTheDocument()
  })

  it('names episodes for an episode, a season or a show', async () => {
    await openAsk({ ask: ready({ downloadKind: 'season', files: 10 }) })
    expect(await screen.findByText(/Dune \(10 episodes, /u)).toBeInTheDocument()
  })

  it('sends confirmDownload with the checkbox, and closes', async () => {
    const client = await openAsk({ ask: ready() })
    const dialog = await screen.findByRole('dialog', { name: 'Download to raven player' })
    const box = within(dialog).getByRole('checkbox', { name: 'Delete once watched' })
    expect(box).not.toBeChecked()
    await userEvent.click(box)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download' }))
    await waitFor(() =>
      expect(sentOfType({ client, type: 'confirmDownload' })).toEqual([
        { type: 'confirmDownload', askId: ASK, autoDelete: true },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(sentOfType({ client, type: 'declineDownload' })).toEqual([])
  })

  it('starts the checkbox at the ask', async () => {
    await openAsk({ ask: { ...ready(), autoDelete: true } })
    expect(await screen.findByRole('checkbox', { name: 'Delete once watched' })).toBeChecked()
  })

  it('says why main refused the download, as a notice', async () => {
    const client = fakeClient({
      request: async (asked) => {
        if (asked.type === 'listRecents') return { type: 'recents', recents: [] }
        if (asked.type === 'confirmDownload')
          return { type: 'refused', message: 'Not enough space' }
        return { type: 'done' }
      },
    })
    await openAsk({ ask: ready(), client })
    await userEvent.click(await screen.findByRole('button', { name: 'Download' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Not enough space')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sends declineDownload on Cancel, and closes', async () => {
    const client = await openAsk({ ask: ready() })
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(sentOfType({ client, type: 'declineDownload' })).toEqual([
        { type: 'declineDownload', askId: ASK },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(sentOfType({ client, type: 'confirmDownload' })).toEqual([])
  })

  it('declines on Escape', async () => {
    const client = await openAsk({ ask: ready() })
    const dialog = await screen.findByRole('dialog', { name: 'Download to raven player' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(sentOfType({ client, type: 'declineDownload' })).toHaveLength(1))
  })

  it('says what is needed and offers no Download when the files do not fit', async () => {
    await openAsk({ ask: ready({ fits: false, free: 12 * GB }) })
    const dialog = await screen.findByRole('dialog', { name: 'Download to raven player' })
    expect(
      within(dialog).getByText(`Needs ${formatBytes(41.2 * GB)}; ${formatBytes(12 * GB)} free.`),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Download' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('says a title is already downloaded when no file is left to fetch', async () => {
    const client = await openAsk({ ask: ready({ files: 0, bytes: 0 }) })
    const dialog = await screen.findByRole('dialog', { name: 'Download to raven player' })
    expect(within(dialog).getByText('Dune is already downloaded.')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Download' })).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(sentOfType({ client, type: 'declineDownload' })).toHaveLength(1))
  })

  it('asks for the PIN on a locked ask, then asks main again and shows the new ask', async () => {
    const client = serverClient({
      calls: { 'POST /api/lock/unlock': reply({ body: { available: true, unlocked: true } }) },
      replies: { retryDownloadAsk: { type: 'downloadAsk', ask: ready() } },
    })
    await openAsk({ ask: { ...ready(), status: { kind: 'locked' } }, client })
    expect(await screen.findByRole('dialog', { name: 'Locked library' })).toBeInTheDocument()
    expect(screen.getByText(SERVER_COPY.pinHint('Vhagar'))).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('PIN'), '1234')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitFor(() =>
      expect(sentOfType({ client, type: 'retryDownloadAsk' })).toEqual([
        { type: 'retryDownloadAsk', askId: ASK },
      ]),
    )
    expect(
      await screen.findByRole('dialog', { name: 'Download to raven player' }),
    ).toBeInTheDocument()
    expect(sentOfType({ client, type: 'declineDownload' })).toEqual([])
  })

  it('asks for the admin password on a hidden ask', async () => {
    const client = serverClient({
      calls: { 'POST /api/admin/unlock': reply({ body: { state: 'off', available: true } }) },
      replies: { retryDownloadAsk: { type: 'downloadAsk', ask: ready() } },
    })
    await openAsk({ ask: { ...ready(), status: { kind: 'hidden' } }, client })
    expect(await screen.findByRole('dialog', { name: 'Admin lock' })).toBeInTheDocument()
    expect(screen.getByText(SERVER_COPY.adminHint('Vhagar'))).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Admin password'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitFor(() => expect(sentOfType({ client, type: 'retryDownloadAsk' })).toHaveLength(1))
  })

  it('closes with a notice when main refuses the retry', async () => {
    const client = serverClient({
      calls: { 'POST /api/lock/unlock': reply({ body: { available: true, unlocked: true } }) },
      replies: { retryDownloadAsk: { type: 'refused', message: 'That link has expired.' } },
    })
    await openAsk({ ask: { ...ready(), status: { kind: 'locked' } }, client })
    await userEvent.type(await screen.findByLabelText('PIN'), '1234')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('status')).toHaveTextContent('That link has expired.')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('declines when the PIN dialog is cancelled', async () => {
    const client = await openAsk({ ask: { ...ready(), status: { kind: 'locked' } } })
    const dialog = await screen.findByRole('dialog', { name: 'Locked library' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(sentOfType({ client, type: 'declineDownload' })).toEqual([
        { type: 'declineDownload', askId: ASK },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows a notice and closes when confirming fails', async () => {
    const client = fakeClient({
      request: async (asked) => {
        if (asked.type === 'confirmDownload') throw new Error('The connection closed.')
        return asked.type === 'listRecents' ? { type: 'recents', recents: [] } : { type: 'done' }
      },
    })
    await openAsk({ ask: ready(), client })
    await userEvent.click(await screen.findByRole('button', { name: 'Download' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'raven player could not reach its downloads. Try again.',
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a notice and closes when asking again fails', async () => {
    const base = serverClient({
      calls: { 'POST /api/lock/unlock': reply({ body: { available: true, unlocked: true } }) },
    })
    const client = fakeClient({
      request: async (asked) => {
        if (asked.type === 'retryDownloadAsk') throw new Error('The connection closed.')
        return base.request(asked)
      },
    })
    await openAsk({ ask: { ...ready(), status: { kind: 'locked' } }, client })
    await userEvent.type(await screen.findByLabelText('PIN'), '1234')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'raven player could not reach its downloads. Try again.',
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('asks for the PIN again when main still finds the ask locked', async () => {
    const locked: DownloadAsk = { ...ready(), status: { kind: 'locked' } }
    const client = serverClient({
      calls: { 'POST /api/lock/unlock': reply({ body: { available: true, unlocked: true } }) },
      replies: { retryDownloadAsk: { type: 'downloadAsk', ask: locked } },
    })
    await openAsk({ ask: locked, client })
    await userEvent.type(await screen.findByLabelText('PIN'), '1234')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitFor(() => expect(sentOfType({ client, type: 'retryDownloadAsk' })).toHaveLength(1))
    await waitFor(() => expect(screen.getByLabelText('PIN')).toHaveValue(''))
    expect(screen.getByRole('dialog', { name: 'Locked library' })).toBeInTheDocument()
  })
})
