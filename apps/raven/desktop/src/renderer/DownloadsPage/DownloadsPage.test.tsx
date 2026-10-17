import { describe, expect, it } from 'bun:test'
import { formatBytes } from '@raven/core'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { watchedLabel } from '@/renderer/desktop/watched'
import { SERVER_COPY } from '@/renderer/ServerPage/serverServices'
import {
  DL_1,
  DL_2,
  DL_3,
  DL_4,
  DL_5,
  downloadsMain,
  GB,
  settleInAct,
  SPACE,
  viewOf,
} from '@/renderer/test/downloadFakes'
import { fakeClient, renderDesktop } from '@/renderer/test/render'
import { heldReply, reply, S, sentOfType } from '@/renderer/test/serverFakes'
import type { DownloadView } from '@/shared/protocol'

const ROWS: DownloadView[] = [
  viewOf({
    downloadId: DL_1,
    label: 'S01E01 Good News',
    status: { kind: 'downloading', bytes: 1.2 * GB },
  }),
  viewOf({ downloadId: DL_2, label: 'S01E02 Half Loop', status: { kind: 'queued' } }),
  viewOf({
    downloadId: DL_3,
    label: 'S01E03 In Perpetuity',
    status: { kind: 'paused', bytes: 0, message: null },
  }),
  viewOf({
    downloadId: DL_4,
    label: 'S01E04 The You You Are',
    status: { kind: 'failed', bytes: 0, message: 'Not enough space' },
  }),
  viewOf({
    downloadId: DL_5,
    label: 'The Two Towers (2002)',
    group: { kind: 'saga', key: 'saga:1:119', title: 'The Lord of the Rings', order: 1 },
    size: 14.8 * GB,
    status: { kind: 'ready' },
    watched: 0.5,
    autoDelete: true,
  }),
]

const openPage = async (options: Parameters<typeof downloadsMain>[0] = {}) => {
  const main = downloadsMain(options)
  const rendered = renderDesktop({ client: main.client, route: '/downloads' })
  const page = await screen.findByRole('main', { name: 'Downloads' })
  return { ...main, ...rendered, page }
}

const rowOf = async (label: string) => {
  const rows = await screen.findAllByRole('listitem')
  const row = rows.find((candidate) => within(candidate).queryByText(label) !== null)
  if (row === undefined) throw new Error(`no row for ${label}`)
  return row
}

describe('DownloadsPage', () => {
  it('focuses its heading on arrival', async () => {
    await openPage()
    expect(await screen.findByRole('heading', { name: 'Downloads' })).toHaveFocus()
  })

  it('goes back Home', async () => {
    const { router } = await openPage()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('says how to download something when there is nothing yet', async () => {
    await openPage()
    expect(
      await screen.findByText(
        'Nothing downloaded yet. Open a title in raven on the web and choose Download to raven player.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('shows the disk as a meter and the space line', async () => {
    await openPage()
    const meter = await screen.findByRole('meter', { name: 'Disk' })
    expect(meter).toHaveAttribute('min', '0')
    expect(meter).toHaveAttribute('max', String(SPACE.total))
    expect(meter).toHaveAttribute('value', String(SPACE.used))
    expect(
      screen.getByText(
        `${formatBytes(SPACE.used)} of downloads · ${formatBytes(SPACE.free)} free of ${formatBytes(SPACE.total)}`,
      ),
    ).toBeInTheDocument()
  })

  it('lists the rows in the order main gives them', async () => {
    await openPage({ downloads: ROWS })
    const rows = await screen.findAllByRole('listitem')
    const labelOf = (row: HTMLElement) =>
      ROWS.find((view) => within(row).queryByText(view.label) !== null)?.label ?? null
    expect(rows.map(labelOf)).toEqual(ROWS.map((view) => view.label))
  })

  it('shows what each row belongs to, where it came from and its size', async () => {
    await openPage({ downloads: ROWS })
    const ready = await rowOf('The Two Towers (2002)')
    expect(within(ready).getByText('The Lord of the Rings · Vhagar')).toBeInTheDocument()
    expect(within(ready).getByText(formatBytes(14.8 * GB))).toBeInTheDocument()
  })

  it('names only the group when the server is gone', async () => {
    await openPage({ downloads: [viewOf({ serverName: '' })] })
    const row = await rowOf('S01E01 Good News')
    expect(within(row).getByText('Severance')).toBeInTheDocument()
  })

  it('shows each status in its own words', async () => {
    await openPage({
      downloads: [
        ...ROWS,
        viewOf({
          downloadId: '0a000000-0000-4000-8000-000000000006',
          label: 'S01E05 The Grim Barbarity',
          status: { kind: 'paused', bytes: 0, message: 'Vhagar could not be reached' },
        }),
      ],
    })
    const downloading = await rowOf('S01E01 Good News')
    expect(
      within(downloading).getByRole('progressbar', {
        name: `${formatBytes(1.2 * GB)} of ${formatBytes(2 * GB)}`,
      }),
    ).toHaveAttribute('value', String(1.2 * GB))
    expect(within(await rowOf('S01E02 Half Loop')).getByText('Waiting')).toBeInTheDocument()
    expect(within(await rowOf('S01E03 In Perpetuity')).getByText('Paused')).toBeInTheDocument()
    expect(
      within(await rowOf('S01E05 The Grim Barbarity')).getByText('Vhagar could not be reached'),
    ).toBeInTheDocument()
    expect(
      within(await rowOf('S01E04 The You You Are')).getByText('Failed: Not enough space'),
    ).toBeInTheDocument()
    expect(
      within(await rowOf('The Two Towers (2002)')).getByRole('progressbar', {
        name: watchedLabel(0.5),
      }),
    ).toBeInTheDocument()
  })

  it('offers each row the action its status allows', async () => {
    await openPage({ downloads: ROWS })
    const buttonsOf = async (label: string) =>
      within(await rowOf(label))
        .getAllByRole('button')
        .map((button) => button.textContent)
    expect(await buttonsOf('S01E01 Good News')).toEqual(['Pause', 'Delete'])
    expect(await buttonsOf('S01E02 Half Loop')).toEqual(['Pause', 'Delete'])
    expect(await buttonsOf('S01E03 In Perpetuity')).toEqual(['Resume', 'Delete'])
    expect(await buttonsOf('S01E04 The You You Are')).toEqual(['Retry', 'Delete'])
    expect(await buttonsOf('The Two Towers (2002)')).toEqual(['Play', 'Delete'])
  })

  it('plays a ready row through main, and says why main would not', async () => {
    const { client } = await openPage({
      downloads: ROWS,
      answers: {
        openDownload: { type: 'refused', message: 'raven player does not play downloads yet.' },
      },
    })
    const row = await rowOf('The Two Towers (2002)')
    await userEvent.click(within(row).getByRole('button', { name: 'Play The Two Towers (2002)' }))
    expect(sentOfType({ client, type: 'openDownload' })).toEqual([
      { type: 'openDownload', downloadId: DL_5 },
    ])
    expect(await screen.findByRole('status')).toHaveTextContent(
      'raven player does not play downloads yet.',
    )
  })

  it('plays what main answers Play with', async () => {
    const fileId = '0b000000-0000-4000-8000-000000000001'
    const { router } = await openPage({
      downloads: ROWS,
      answers: { openDownload: { type: 'play', target: { fileId, queue: [] } } },
    })
    const row = await rowOf('The Two Towers (2002)')
    await userEvent.click(within(row).getByRole('button', { name: 'Play The Two Towers (2002)' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/play/${fileId}`))
  })

  it('pauses a row and shows the list main answers with', async () => {
    const { client } = await openPage({ downloads: ROWS })
    const row = await rowOf('S01E01 Good News')
    await userEvent.click(within(row).getByRole('button', { name: 'Pause S01E01 Good News' }))
    expect(sentOfType({ client, type: 'pauseDownload' })).toEqual([
      { type: 'pauseDownload', downloadId: DL_1 },
    ])
    expect(
      await within(row).findByRole('button', { name: 'Resume S01E01 Good News' }),
    ).toBeInTheDocument()
    expect(within(row).getByText('Paused')).toBeInTheDocument()
  })

  it('reads the disk again once main answers a change', async () => {
    const { client } = await openPage({ downloads: ROWS })
    await screen.findByRole('meter', { name: 'Disk' })
    expect(sentOfType({ client, type: 'readSpace' })).toHaveLength(1)
    const row = await rowOf('S01E01 Good News')
    await userEvent.click(within(row).getByRole('button', { name: 'Pause S01E01 Good News' }))
    await waitFor(() => expect(sentOfType({ client, type: 'readSpace' })).toHaveLength(2))
  })

  it('resumes a paused row', async () => {
    const { client } = await openPage({ downloads: ROWS })
    const row = await rowOf('S01E03 In Perpetuity')
    await userEvent.click(within(row).getByRole('button', { name: 'Resume S01E03 In Perpetuity' }))
    expect(sentOfType({ client, type: 'resumeDownload' })).toEqual([
      { type: 'resumeDownload', downloadId: DL_3 },
    ])
    expect(await within(row).findByText('Waiting')).toBeInTheDocument()
  })

  it('retries a failed row', async () => {
    const { client } = await openPage({ downloads: ROWS })
    const row = await rowOf('S01E04 The You You Are')
    await userEvent.click(within(row).getByRole('button', { name: 'Retry S01E04 The You You Are' }))
    expect(sentOfType({ client, type: 'retryDownload' })).toEqual([
      { type: 'retryDownload', downloadId: DL_4 },
    ])
  })

  it('switches Delete once watched for one row', async () => {
    const { client } = await openPage({ downloads: ROWS })
    const row = await rowOf('S01E01 Good News')
    const toggle = within(row).getByRole('switch', { name: 'Delete once watched' })
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription('S01E01 Good News')
    expect(
      within(await rowOf('The Two Towers (2002)')).getByRole('switch', {
        name: 'Delete once watched',
      }),
    ).toBeChecked()
    await userEvent.click(toggle)
    expect(sentOfType({ client, type: 'setDownloadAutoDelete' })).toEqual([
      { type: 'setDownloadAutoDelete', downloadId: DL_1, autoDelete: true },
    ])
    await waitFor(() => expect(toggle).toBeChecked())
  })

  it('asks before it deletes a row, and Cancel puts the row back', async () => {
    const { client } = await openPage({ downloads: ROWS })
    const row = await rowOf('The Two Towers (2002)')
    await userEvent.click(within(row).getByRole('button', { name: 'Delete The Two Towers (2002)' }))
    const question = `Delete The Two Towers (2002)? ${formatBytes(14.8 * GB)} will be freed.`
    expect(within(row).getByText(question)).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Delete' })).toHaveAccessibleDescription(
      question,
    )
    const cancel = within(row).getByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(cancel).toHaveFocus())
    await userEvent.click(cancel)
    expect(within(row).queryByText(question)).toBeNull()
    expect(within(row).getByRole('button', { name: 'Delete The Two Towers (2002)' })).toHaveFocus()
    expect(sentOfType({ client, type: 'deleteDownload' })).toEqual([])
  })

  it('deletes a row once asked, and the page keeps the focus', async () => {
    const { client } = await openPage({ downloads: ROWS })
    const row = await rowOf('The Two Towers (2002)')
    await userEvent.click(within(row).getByRole('button', { name: 'Delete The Two Towers (2002)' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    expect(sentOfType({ client, type: 'deleteDownload' })).toEqual([
      { type: 'deleteDownload', downloadId: DL_5 },
    ])
    await waitFor(() => expect(screen.queryByText('The Two Towers (2002)')).toBeNull())
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByRole('heading', { name: 'Downloads' })).toHaveFocus()
  })

  it('asks for the PIN before it resumes a row its server locked again', async () => {
    const relocked = viewOf({
      downloadId: DL_3,
      label: 'S01E03 In Perpetuity',
      status: { kind: 'paused', bytes: 0, message: 'Vhagar locked this library again' },
      needsUnlock: true,
    })
    const { client } = await openPage({
      downloads: [relocked],
      extra: (request) =>
        request.type === 'serverCall' && request.path === '/api/lock/unlock'
          ? reply({ body: { available: true, unlocked: true } })
          : null,
    })
    const row = await rowOf('S01E03 In Perpetuity')
    expect(within(row).getByText('Vhagar locked this library again')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Resume S01E03 In Perpetuity' }))
    const dialog = await screen.findByRole('dialog', { name: 'Locked library' })
    expect(within(dialog).getByText(SERVER_COPY.pinHint('Vhagar'))).toBeInTheDocument()
    expect(sentOfType({ client, type: 'resumeDownload' })).toEqual([])
    await userEvent.type(within(dialog).getByLabelText('PIN'), '1234')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unlock' }))
    await waitFor(() =>
      expect(sentOfType({ client, type: 'resumeDownload' })).toEqual([
        { type: 'resumeDownload', downloadId: DL_3 },
      ]),
    )
    expect(sentOfType({ client, type: 'serverCall' })).toEqual([
      {
        type: 'serverCall',
        serverId: S,
        method: 'POST',
        path: '/api/lock/unlock',
        body: JSON.stringify({ pin: '1234' }),
      },
    ])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('sends nothing when the PIN dialog is cancelled', async () => {
    const { client } = await openPage({
      downloads: [
        viewOf({
          downloadId: DL_3,
          label: 'S01E03 In Perpetuity',
          status: { kind: 'paused', bytes: 0, message: 'Vhagar locked this library again' },
          needsUnlock: true,
        }),
      ],
    })
    const row = await rowOf('S01E03 In Perpetuity')
    await userEvent.click(within(row).getByRole('button', { name: 'Resume S01E03 In Perpetuity' }))
    const dialog = await screen.findByRole('dialog', { name: 'Locked library' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(sentOfType({ client, type: 'resumeDownload' })).toEqual([])
    expect(sentOfType({ client, type: 'serverCall' })).toEqual([])
  })

  it('offers Pause all while anything is queued or downloading', async () => {
    const { client } = await openPage({
      downloads: ROWS.filter(({ status }) => status.kind !== 'paused'),
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Pause all' }))
    expect(sentOfType({ client, type: 'pauseAllDownloads' })).toEqual([
      { type: 'pauseAllDownloads' },
    ])
    expect(screen.queryByRole('button', { name: 'Resume all' })).toBeNull()
  })

  it('offers Resume all while nothing runs and something is paused', async () => {
    const { client } = await openPage({
      downloads: ROWS.filter(
        ({ status }) => status.kind !== 'queued' && status.kind !== 'downloading',
      ),
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Resume all' }))
    expect(sentOfType({ client, type: 'resumeAllDownloads' })).toEqual([
      { type: 'resumeAllDownloads' },
    ])
    expect(screen.queryByRole('button', { name: 'Pause all' })).toBeNull()
  })

  it('offers Resume all beside Pause all while one row is paused and another downloads', async () => {
    const { client } = await openPage({
      downloads: ROWS.filter(({ downloadId }) => downloadId === DL_1 || downloadId === DL_3),
    })
    const pauseAll = await screen.findByRole('button', { name: 'Pause all' })
    const resumeAll = screen.getByRole('button', { name: 'Resume all' })
    expect(
      [...document.querySelectorAll('header button')].map((button) => button.textContent),
    ).toEqual(['Back', 'Pause all', 'Resume all'])
    await userEvent.click(resumeAll)
    expect(sentOfType({ client, type: 'resumeAllDownloads' })).toEqual([
      { type: 'resumeAllDownloads' },
    ])
    expect(pauseAll).toBeInTheDocument()
  })

  it('offers neither when nothing is in progress or paused', async () => {
    await openPage({
      downloads: ROWS.filter(({ status }) => status.kind === 'ready' || status.kind === 'failed'),
    })
    await screen.findAllByRole('listitem')
    expect(screen.queryByRole('button', { name: 'Pause all' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Resume all' })).toBeNull()
  })

  it("says main's refusal of a change as a notice", async () => {
    await openPage({
      downloads: ROWS,
      answers: {
        pauseDownload: { type: 'refused', message: 'That download is no longer in raven player.' },
      },
    })
    const row = await rowOf('S01E01 Good News')
    await userEvent.click(within(row).getByRole('button', { name: 'Pause S01E01 Good News' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'That download is no longer in raven player.',
    )
  })

  it('reads the disk again when main pushes a file finished or gone, not on progress', async () => {
    const { client } = await openPage({ downloads: ROWS })
    await screen.findByRole('meter', { name: 'Disk' })
    await rowOf('S01E01 Good News')
    const readsOfSpace = () => sentOfType({ client, type: 'readSpace' }).length
    expect(readsOfSpace()).toBe(1)
    const withFirst = (status: DownloadView['status']) =>
      ROWS.map((view) => (view.downloadId === DL_1 ? { ...view, status } : view))
    await client.emit({
      type: 'downloads',
      downloads: withFirst({ kind: 'downloading', bytes: 1.5 * GB }),
      autoDeleteDefault: false,
    })
    expect(
      await screen.findByRole('progressbar', {
        name: `${formatBytes(1.5 * GB)} of ${formatBytes(2 * GB)}`,
      }),
    ).toBeInTheDocument()
    expect(readsOfSpace()).toBe(1)
    await client.emit({
      type: 'downloads',
      downloads: withFirst({ kind: 'ready' }),
      autoDeleteDefault: false,
    })
    await waitFor(() => expect(readsOfSpace()).toBe(2))
    await client.emit({
      type: 'downloads',
      downloads: withFirst({ kind: 'ready' }).filter((view) => view.downloadId !== DL_5),
      autoDeleteDefault: false,
    })
    await waitFor(() => expect(readsOfSpace()).toBe(3))
  })

  it('sends one delete however often the question is answered while main works', async () => {
    const main = downloadsMain({ downloads: ROWS })
    const held = heldReply()
    const client = fakeClient({
      request: async (request) =>
        request.type === 'deleteDownload' ? held.promise : main.respond(request),
    })
    renderDesktop({ client, route: '/downloads' })
    const row = await rowOf('The Two Towers (2002)')
    await userEvent.click(within(row).getByRole('button', { name: 'Delete The Two Towers (2002)' }))
    const confirm = within(row).getByRole('button', { name: 'Delete' })
    await userEvent.dblClick(confirm)
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    expect(sentOfType({ client, type: 'deleteDownload' })).toHaveLength(1)
    await settleInAct(() =>
      held.resolve(main.respond({ type: 'deleteDownload', downloadId: DL_5 })),
    )
    expect(screen.queryByText('The Two Towers (2002)')).toBeNull()
    expect(sentOfType({ client, type: 'deleteDownload' })).toHaveLength(1)
  })

  it('says so when main does not answer a change', async () => {
    const main = downloadsMain({ downloads: ROWS })
    const client = fakeClient({
      request: async (request) => {
        if (request.type === 'retryDownload') throw new Error('The connection closed.')
        return main.respond(request)
      },
    })
    renderDesktop({ client, route: '/downloads' })
    const row = await rowOf('S01E04 The You You Are')
    await userEvent.click(within(row).getByRole('button', { name: 'Retry S01E04 The You You Are' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'raven player could not reach its downloads. Try again.',
    )
  })

  it('says why the downloads could not be read', async () => {
    await openPage({
      answers: {
        listDownloads: { type: 'refused', message: 'raven player could not read its downloads.' },
      },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'raven player could not read its downloads.',
    )
  })
})
