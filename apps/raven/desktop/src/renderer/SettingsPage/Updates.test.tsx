import { describe, expect, it } from 'bun:test'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeClient, renderDesktop } from '@/renderer/test/render'
import {
  DESKTOP_REQUESTS,
  type DesktopReply,
  type DesktopRequest,
  type UpdateStatus,
} from '@/shared/protocol'

const FRESH: UpdateStatus = {
  isEnabled: true,
  current: '0.5.4',
  checkedAt: null,
  latest: null,
  problem: null,
}

const CHECKED_AT = Date.UTC(2026, 9, 16, 9, 30)

/** Main as the page sees it: the switch is stored, and a check answers `checked`. */
const mainWith = ({
  initial = FRESH,
  checked = { ...FRESH, checkedAt: CHECKED_AT },
  opened = { type: 'done' },
}: {
  initial?: UpdateStatus
  checked?: UpdateStatus
  opened?: DesktopReply
} = {}) => {
  const stored = { status: initial }
  const client = fakeClient({
    request: async (asked: DesktopRequest): Promise<DesktopReply> => {
      switch (asked.type) {
        case DESKTOP_REQUESTS.readUpdates:
          return { type: 'updates', status: stored.status }
        case DESKTOP_REQUESTS.setUpdateCheck:
          stored.status = { ...stored.status, isEnabled: asked.isEnabled }
          return { type: 'updates', status: stored.status }
        case DESKTOP_REQUESTS.checkForUpdates:
          stored.status = { ...checked, isEnabled: stored.status.isEnabled }
          return { type: 'updates', status: stored.status }
        case DESKTOP_REQUESTS.openRelease:
          return opened
        case DESKTOP_REQUESTS.listRecents:
          return { type: 'recents', recents: [] }
        default:
          return { type: 'done' }
      }
    },
  })
  return { client }
}

const sentOf = ({
  client,
  type,
}: {
  client: ReturnType<typeof fakeClient>
  type: DesktopRequest['type']
}) => client.request.mock.calls.map(([sent]) => sent).filter((sent) => sent.type === type)

const renderUpdates = async (options: Parameters<typeof mainWith>[0] = {}) => {
  const main = mainWith(options)
  renderDesktop({ client: main.client, route: '/settings' })
  const section = await screen.findByRole('region', { name: 'Updates' })
  await within(section).findByRole('checkbox', { name: 'Check for updates once a day' })
  return { ...main, section }
}

describe('Updates', () => {
  it('sits after This computer and before Recents', async () => {
    const { section } = await renderUpdates()
    const computer = screen.getByRole('region', { name: 'This computer' })
    const recents = screen.getByRole('region', { name: 'Recents' })
    expect(
      computer.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(section.compareDocumentPosition(recents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says which release this is and that it has not checked yet', async () => {
    const { section } = await renderUpdates()
    expect(within(section).getByText('This is raven player 0.5.4.')).toBeInTheDocument()
    expect(within(section).getByText('Not checked yet.')).toBeInTheDocument()
    expect(within(section).getByRole('status')).toHaveTextContent('')
    expect(within(section).queryByRole('button', { name: "See what's new" })).toBeNull()
  })

  it('never claims the newest release from a stored check alone', async () => {
    const { section } = await renderUpdates({ initial: { ...FRESH, checkedAt: CHECKED_AT } })
    expect(
      within(section).getByText(`Last checked ${new Date(CHECKED_AT).toLocaleString()}.`),
    ).toBeInTheDocument()
    expect(within(section).queryByText(/is the newest release/)).toBeNull()
  })

  it('labels the switch, checks it when on and says what it sends', async () => {
    const { section } = await renderUpdates()
    const box = within(section).getByRole('checkbox', { name: 'Check for updates once a day' })
    expect(box).toBeChecked()
    expect(box).toHaveAccessibleDescription(
      'raven player asks GitHub for its newest release and sends nothing else. It never installs one by itself.',
    )
  })

  it('turns the daily check off', async () => {
    const { section, client } = await renderUpdates()
    const box = within(section).getByRole('checkbox', { name: 'Check for updates once a day' })
    await userEvent.click(box)
    expect(sentOf({ client, type: 'setUpdateCheck' })).toEqual([
      { type: 'setUpdateCheck', isEnabled: false },
    ])
    await waitFor(() => expect(box).not.toBeChecked())
  })

  it('shows the pick while main answers, and puts it back when main refuses', async () => {
    const replies: Array<(reply: DesktopReply) => void> = []
    const client = fakeClient({
      request: async (asked) => {
        if (asked.type === DESKTOP_REQUESTS.readUpdates) return { type: 'updates', status: FRESH }
        if (asked.type === DESKTOP_REQUESTS.listRecents) return { type: 'recents', recents: [] }
        if (asked.type !== DESKTOP_REQUESTS.setUpdateCheck) return { type: 'done' }
        const reply = Promise.withResolvers<DesktopReply>()
        replies.push(reply.resolve)
        return reply.promise
      },
    })
    renderDesktop({ client, route: '/settings' })
    const section = await screen.findByRole('region', { name: 'Updates' })
    const box = await within(section).findByRole('checkbox', {
      name: 'Check for updates once a day',
    })
    await userEvent.click(box)
    expect(box).not.toBeChecked()
    replies.shift()!({ type: 'refused', message: 'raven player could not save its settings.' })
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'raven player could not save its settings.',
    )
    expect(box).toBeChecked()
  })

  it('checks now and shows the newer release from the reply', async () => {
    const { section, client } = await renderUpdates({
      checked: { ...FRESH, checkedAt: CHECKED_AT, latest: '0.6.0' },
    })
    await userEvent.click(within(section).getByRole('button', { name: 'Check now' }))
    expect(sentOf({ client, type: 'checkForUpdates' })).toEqual([{ type: 'checkForUpdates' }])
    await waitFor(() =>
      expect(within(section).getByRole('status')).toHaveTextContent('raven player 0.6.0 is out.'),
    )
    expect(
      within(section).getByText(`Last checked ${new Date(CHECKED_AT).toLocaleString()}.`),
    ).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: "See what's new" })).toBeInTheDocument()
  })

  it('says this is the newest release only after a check that found nothing newer', async () => {
    const { section } = await renderUpdates()
    await userEvent.click(within(section).getByRole('button', { name: 'Check now' }))
    await waitFor(() =>
      expect(within(section).getByRole('status')).toHaveTextContent(
        'raven player 0.5.4 is the newest release.',
      ),
    )
  })

  it('opens the release page through main', async () => {
    const { section, client } = await renderUpdates({ initial: { ...FRESH, latest: '0.6.0' } })
    expect(within(section).getByRole('status')).toHaveTextContent('raven player 0.6.0 is out.')
    await userEvent.click(within(section).getByRole('button', { name: "See what's new" }))
    expect(sentOf({ client, type: 'openRelease' })).toEqual([{ type: 'openRelease' }])
  })

  it("hides the Shell's notice once Settings has opened the release page", async () => {
    const { client } = mainWith({ initial: { ...FRESH, latest: '0.6.0' } })
    renderDesktop({ client, route: '/settings' })
    const section = await screen.findByRole('region', { name: 'Updates' })
    await client.emit({ type: 'updateAvailable', version: '0.6.0' })
    expect(screen.getByRole('complementary', { name: 'Update' })).toBeInTheDocument()
    await userEvent.click(await within(section).findByRole('button', { name: "See what's new" }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Update' })).toBeNull())
    expect(within(section).getByRole('button', { name: "See what's new" })).toHaveFocus()
  })

  it("keeps the place when Settings hides the Shell's notice while it holds focus", async () => {
    const opened = Promise.withResolvers<DesktopReply>()
    const client = fakeClient({
      request: async (asked) => {
        if (asked.type === DESKTOP_REQUESTS.readUpdates) {
          return { type: 'updates', status: { ...FRESH, latest: '0.6.0' } }
        }
        if (asked.type === DESKTOP_REQUESTS.openRelease) return opened.promise
        if (asked.type === DESKTOP_REQUESTS.listRecents) return { type: 'recents', recents: [] }
        return { type: 'done' }
      },
    })
    renderDesktop({ client, route: '/settings' })
    const section = await screen.findByRole('region', { name: 'Updates' })
    await client.emit({ type: 'updateAvailable', version: '0.6.0' })
    const notice = screen.getByRole('complementary', { name: 'Update' })
    await userEvent.click(await within(section).findByRole('button', { name: "See what's new" }))
    within(notice).getByRole('button', { name: 'Dismiss' }).focus()
    await act(async () => opened.resolve({ type: 'done' }))
    expect(screen.queryByRole('complementary', { name: 'Update' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toHaveFocus()
  })

  it('says why main could not open the release page', async () => {
    const { section } = await renderUpdates({
      initial: { ...FRESH, latest: '0.6.0' },
      opened: { type: 'refused', message: 'raven player has not found a newer release.' },
    })
    await userEvent.click(within(section).getByRole('button', { name: "See what's new" }))
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'raven player has not found a newer release.',
    )
  })

  it('shows the problem a check ran into', async () => {
    const { section } = await renderUpdates({
      checked: { ...FRESH, checkedAt: CHECKED_AT, problem: 'GitHub did not answer.' },
    })
    await userEvent.click(within(section).getByRole('button', { name: 'Check now' }))
    await waitFor(() =>
      expect(within(section).getByRole('status')).toHaveTextContent(
        'raven player could not check for updates. GitHub did not answer.',
      ),
    )
    expect(within(section).queryByText(/is the newest release/)).toBeNull()
  })

  it('never claims the newest release when GitHub listed none', async () => {
    const { section } = await renderUpdates({
      checked: {
        ...FRESH,
        checkedAt: CHECKED_AT,
        problem: 'GitHub listed no raven player release.',
      },
    })
    await userEvent.click(within(section).getByRole('button', { name: 'Check now' }))
    await waitFor(() =>
      expect(within(section).getByRole('status')).toHaveTextContent(
        'raven player could not check for updates. GitHub listed no raven player release.',
      ),
    )
    expect(within(section).queryByText(/is the newest release/)).toBeNull()
    expect(within(section).queryByRole('button', { name: "See what's new" })).toBeNull()
  })

  it('shows an earlier newer release beside a later problem', async () => {
    const { section } = await renderUpdates({
      initial: { ...FRESH, latest: '0.6.0', problem: 'GitHub is busy. Try again later.' },
    })
    const status = within(section).getByRole('status')
    expect(status).toHaveTextContent('raven player 0.6.0 is out.')
    expect(status).toHaveTextContent(
      'raven player could not check for updates. GitHub is busy. Try again later.',
    )
    expect(within(section).getByRole('button', { name: "See what's new" })).toBeInTheDocument()
  })

  it('says so when main cannot read the update settings', async () => {
    renderDesktop({ client: fakeClient(), route: '/settings' })
    const section = await screen.findByRole('region', { name: 'Updates' })
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'raven player could not read its update settings.',
    )
    expect(within(section).queryByRole('checkbox')).toBeNull()
  })
})
