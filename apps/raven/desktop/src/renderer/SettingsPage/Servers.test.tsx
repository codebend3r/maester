import { describe, expect, it } from 'bun:test'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RECENTS_KEY } from '@/renderer/Shell/openReply'
import { accountOf } from '@/renderer/test/accountFakes'
import { DL_1, DL_2, DL_3, viewOf } from '@/renderer/test/downloadFakes'
import { fakeClient, renderDesktop } from '@/renderer/test/render'
import { S, VHAGAR } from '@/renderer/test/serverFakes'
import {
  ACCOUNT_STATES,
  type AccountView,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopReply,
  type DesktopRequest,
  type DownloadView,
  type ServerView,
} from '@/shared/protocol'

const T = '44444444-4444-4444-8444-444444444444'

const MELEYS: ServerView = { serverId: T, origin: 'https://meleys.example:8443', name: 'Meleys' }

const ADDED: ServerView = {
  serverId: '55555555-5555-4555-8555-555555555555',
  origin: 'https://raven.example.ts.net',
  name: 'raven.example.ts.net',
}

type Answers = {
  addServer?: DesktopReply
  renameServer?: DesktopReply
  removeServer?: DesktopReply
  signIn?: DesktopReply
  refreshAccount?: DesktopReply
  openAccountPage?: DesktopReply
}

/** Main as Settings sees it: it keeps the servers, and answers each change with the list or `answers`. */
const mainWith = ({
  servers = [VHAGAR, MELEYS],
  answers = {},
  downloads = [],
  accounts = [],
}: {
  servers?: ServerView[]
  answers?: Answers
  downloads?: DownloadView[]
  /** What main answers readAccount with, by server; a server not listed answers `done`, as an old main would. */
  accounts?: AccountView[]
} = {}) => {
  const stored = { servers, accounts }
  const accountReply = (serverId: string): DesktopReply => {
    const account = stored.accounts.find((candidate) => candidate.serverId === serverId)
    return account === undefined
      ? { type: DESKTOP_REPLIES.done }
      : { type: DESKTOP_REPLIES.account, account }
  }
  const keep = (reply: DesktopReply): DesktopReply => {
    if (reply.type !== DESKTOP_REPLIES.account) return reply
    stored.accounts = [
      ...stored.accounts.filter((candidate) => candidate.serverId !== reply.account.serverId),
      reply.account,
    ]
    return reply
  }
  const listed = (): DesktopReply => ({ type: 'servers', servers: stored.servers })
  const client = fakeClient({
    request: async (asked: DesktopRequest) => {
      switch (asked.type) {
        case DESKTOP_REQUESTS.listServers:
          return listed()
        case DESKTOP_REQUESTS.listRecents:
          return { type: 'recents', recents: [] }
        case DESKTOP_REQUESTS.listDownloads:
          return { type: DESKTOP_REPLIES.downloads, downloads, autoDeleteDefault: false }
        case DESKTOP_REQUESTS.addServer:
          if (answers.addServer !== undefined) return answers.addServer
          stored.servers = [...stored.servers, ADDED]
          return listed()
        case DESKTOP_REQUESTS.renameServer:
          if (answers.renameServer !== undefined) return answers.renameServer
          stored.servers = stored.servers.map((server) =>
            server.serverId === asked.serverId ? { ...server, name: asked.name.trim() } : server,
          )
          return listed()
        case DESKTOP_REQUESTS.removeServer:
          if (answers.removeServer !== undefined) return answers.removeServer
          stored.servers = stored.servers.filter((server) => server.serverId !== asked.serverId)
          return listed()
        case DESKTOP_REQUESTS.readAccount:
          return accountReply(asked.serverId)
        case DESKTOP_REQUESTS.refreshAccount:
          return keep(answers.refreshAccount ?? accountReply(asked.serverId))
        case DESKTOP_REQUESTS.signIn:
          return keep(
            answers.signIn ?? {
              type: DESKTOP_REPLIES.account,
              account: accountOf({
                serverId: asked.serverId,
                state: ACCOUNT_STATES.approved,
                email: asked.email,
              }),
            },
          )
        case DESKTOP_REQUESTS.signOut:
          return keep({
            type: DESKTOP_REPLIES.account,
            account: accountOf({ serverId: asked.serverId }),
          })
        case DESKTOP_REQUESTS.openAccountPage:
          return answers.openAccountPage ?? { type: DESKTOP_REPLIES.done }
        default:
          return { type: DESKTOP_REPLIES.done }
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
}): DesktopRequest[] =>
  client.request.mock.calls.map(([request]) => request).filter((request) => request.type === type)

const renderServers = async (options: Parameters<typeof mainWith>[0] = {}) => {
  const main = mainWith(options)
  const rendered = renderDesktop({ client: main.client, route: '/settings' })
  const section = await screen.findByRole('region', { name: 'Servers' })
  return { ...main, ...rendered, section }
}

const rowOf = async ({ section, name }: { section: HTMLElement; name: string }) => {
  const rows = await within(section).findAllByRole('listitem')
  const row = rows.find((candidate) => within(candidate).queryByText(name) !== null)
  if (row === undefined) throw new Error(`no row for ${name}`)
  return row
}

/** Remove, then the confirm's Remove: the two steps a removal takes. */
const removeFrom = async ({ section, name }: { section: HTMLElement; name: string }) => {
  await userEvent.click(await within(section).findByRole('button', { name: `Remove ${name}` }))
  const row = await rowOf({ section, name: `Remove ${name}? This signs raven player out of it.` })
  await userEvent.click(within(row).getByRole('button', { name: 'Remove' }))
}

describe('Servers', () => {
  it('sits above This computer in Settings', async () => {
    const { section } = await renderServers()
    const computer = screen.getByRole('region', { name: 'This computer' })
    expect(
      section.compareDocumentPosition(computer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('explains what the servers are for', async () => {
    const { section } = await renderServers()
    expect(
      within(section).getByText(
        'raven player plays titles from these raven servers. It signs in to each one separately.',
      ),
    ).toBeInTheDocument()
  })

  it('says how to add one when there are none', async () => {
    const { section } = await renderServers({ servers: [] })
    expect(
      await within(section).findByText(
        'No servers yet. Open a title with Open in raven player on raven web, or add a server here.',
      ),
    ).toBeInTheDocument()
    expect(within(section).queryByRole('list')).toBeNull()
  })

  it('lists each server with its name and its origin in code', async () => {
    const { section } = await renderServers()
    const rows = await within(section).findAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('Vhagar')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('https://raven.example').tagName).toBe('CODE')
    expect(within(rows[1]!).getByText('Meleys')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('https://meleys.example:8443').tagName).toBe('CODE')
  })

  it('renames a server and says so', async () => {
    const { section, client } = await renderServers()
    const row = await rowOf({ section, name: 'Vhagar' })
    await userEvent.click(within(row).getByRole('button', { name: 'Rename Vhagar' }))
    const field = within(section).getByRole('textbox', { name: 'Name for https://raven.example' })
    await waitFor(() => expect(field).toHaveFocus())
    expect(field).toHaveValue('Vhagar')
    await userEvent.clear(field)
    await userEvent.type(field, 'NAS')
    await userEvent.click(within(section).getByRole('button', { name: 'Save' }))
    expect(sentOf({ client, type: 'renameServer' })).toEqual([
      { type: 'renameServer', serverId: S, name: 'NAS' },
    ])
    await waitFor(() =>
      expect(within(section).getByRole('status')).toHaveTextContent('Renamed to NAS.'),
    )
    expect(await within(section).findByText('NAS')).toBeInTheDocument()
    expect(
      within(section).queryByRole('textbox', { name: 'Name for https://raven.example' }),
    ).toBeNull()
    expect(within(section).getByRole('button', { name: 'Rename NAS' })).toHaveFocus()
  })

  it('cancels a rename with Cancel or Escape, sending nothing', async () => {
    const { section, client } = await renderServers()
    const row = await rowOf({ section, name: 'Vhagar' })
    await userEvent.click(within(row).getByRole('button', { name: 'Rename Vhagar' }))
    await userEvent.click(within(section).getByRole('button', { name: 'Cancel' }))
    expect(
      within(section).queryByRole('textbox', { name: 'Name for https://raven.example' }),
    ).toBeNull()
    expect(within(section).getByRole('button', { name: 'Rename Vhagar' })).toHaveFocus()
    await userEvent.click(within(section).getByRole('button', { name: 'Rename Vhagar' }))
    const field = within(section).getByRole('textbox', { name: 'Name for https://raven.example' })
    await waitFor(() => expect(field).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    expect(
      within(section).queryByRole('textbox', { name: 'Name for https://raven.example' }),
    ).toBeNull()
    expect(sentOf({ client, type: 'renameServer' })).toEqual([])
  })

  it('says why main refused a rename, as an alert, and keeps the form', async () => {
    const { section } = await renderServers({
      answers: {
        renameServer: { type: 'refused', message: 'A server name needs 1 to 80 characters.' },
      },
    })
    const row = await rowOf({ section, name: 'Vhagar' })
    await userEvent.click(within(row).getByRole('button', { name: 'Rename Vhagar' }))
    await userEvent.click(within(section).getByRole('button', { name: 'Save' }))
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'A server name needs 1 to 80 characters.',
    )
    expect(within(section).getByRole('status')).toHaveTextContent('')
    const field = within(section).getByRole('textbox', { name: 'Name for https://raven.example' })
    await waitFor(() => expect(field).toHaveFocus())
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('A server name needs 1 to 80 characters.')
    expect(within(section).getByRole('alert')).toHaveAttribute('data-refused', 'true')
  })

  it('opens a later rename without the refusal an earlier one got', async () => {
    const { section } = await renderServers({
      answers: {
        renameServer: { type: 'refused', message: 'A server name needs 1 to 80 characters.' },
      },
    })
    const vhagar = await rowOf({ section, name: 'Vhagar' })
    await userEvent.click(within(vhagar).getByRole('button', { name: 'Rename Vhagar' }))
    await userEvent.click(within(section).getByRole('button', { name: 'Save' }))
    await within(section).findByRole('alert')
    await userEvent.click(within(section).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(within(section).queryByRole('alert')).toBeNull())
    const meleys = await rowOf({ section, name: 'Meleys' })
    await userEvent.click(within(meleys).getByRole('button', { name: 'Rename Meleys' }))
    const field = within(section).getByRole('textbox', {
      name: 'Name for https://meleys.example:8443',
    })
    expect(field).toHaveAttribute('aria-invalid', 'false')
    expect(field).not.toHaveAttribute('aria-describedby')
  })

  it('clears a rename refusal when another row opens its editor', async () => {
    const { section } = await renderServers({
      answers: {
        renameServer: { type: 'refused', message: 'A server name needs 1 to 80 characters.' },
      },
    })
    const vhagar = await rowOf({ section, name: 'Vhagar' })
    await userEvent.click(within(vhagar).getByRole('button', { name: 'Rename Vhagar' }))
    await userEvent.click(within(section).getByRole('button', { name: 'Save' }))
    await within(section).findByRole('alert')
    const meleys = await rowOf({ section, name: 'Meleys' })
    await userEvent.click(within(meleys).getByRole('button', { name: 'Rename Meleys' }))
    await waitFor(() => expect(within(section).queryByRole('alert')).toBeNull())
    expect(
      within(section).getByRole('textbox', { name: 'Name for https://meleys.example:8443' }),
    ).toHaveAttribute('aria-invalid', 'false')
  })

  it('cancels a rename with Escape from its buttons too', async () => {
    const { section, client } = await renderServers()
    const row = await rowOf({ section, name: 'Vhagar' })
    await userEvent.click(within(row).getByRole('button', { name: 'Rename Vhagar' }))
    within(section).getByRole('button', { name: 'Save' }).focus()
    await userEvent.keyboard('{Escape}')
    expect(
      within(section).queryByRole('textbox', { name: 'Name for https://raven.example' }),
    ).toBeNull()
    expect(within(section).getByRole('button', { name: 'Rename Vhagar' })).toHaveFocus()
    expect(sentOf({ client, type: 'renameServer' })).toEqual([])
  })

  it('renames one server at a time', async () => {
    const { section } = await renderServers()
    await userEvent.click(await within(section).findByRole('button', { name: 'Rename Vhagar' }))
    await userEvent.click(within(section).getByRole('button', { name: 'Rename Meleys' }))
    expect(
      within(section).queryByRole('textbox', { name: 'Name for https://raven.example' }),
    ).toBeNull()
    const field = within(section).getByRole('textbox', {
      name: 'Name for https://meleys.example:8443',
    })
    await waitFor(() => expect(field).toHaveFocus())
    expect(within(section).getByRole('button', { name: 'Rename Vhagar' })).toBeInTheDocument()
  })

  it('asks before it removes, and Keep or Escape puts the row back', async () => {
    const { section, client } = await renderServers()
    await userEvent.click(await within(section).findByRole('button', { name: 'Remove Vhagar' }))
    expect(
      within(section).getByText('Remove Vhagar? This signs raven player out of it.'),
    ).toBeInTheDocument()
    const keep = within(section).getByRole('button', { name: 'Keep' })
    await waitFor(() => expect(keep).toHaveFocus())
    await userEvent.click(keep)
    expect(
      within(section).queryByText('Remove Vhagar? This signs raven player out of it.'),
    ).toBeNull()
    expect(within(section).getByRole('button', { name: 'Remove Vhagar' })).toHaveFocus()
    await userEvent.click(within(section).getByRole('button', { name: 'Remove Vhagar' }))
    await waitFor(() => expect(within(section).getByRole('button', { name: 'Keep' })).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    expect(
      within(section).queryByText('Remove Vhagar? This signs raven player out of it.'),
    ).toBeNull()
    expect(within(section).getByRole('button', { name: 'Remove Vhagar' })).toHaveFocus()
    expect(sentOf({ client, type: 'removeServer' })).toEqual([])
  })

  it("says the removal deletes the server's downloads, counted by its id", async () => {
    const { section } = await renderServers({
      downloads: [
        viewOf({ downloadId: DL_1, serverId: S }),
        viewOf({ downloadId: DL_2, serverId: S }),
        // Named like Vhagar, but another server's: the count goes by id.
        viewOf({ downloadId: DL_3, serverId: T, serverName: 'Vhagar' }),
      ],
    })
    await userEvent.click(await within(section).findByRole('button', { name: 'Remove Vhagar' }))
    const question = 'Remove Vhagar? This signs raven player out of it and deletes its 2 downloads.'
    expect(await within(section).findByText(question)).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Remove' })).toHaveAccessibleDescription(
      question,
    )
    await userEvent.click(within(section).getByRole('button', { name: 'Keep' }))
    await userEvent.click(within(section).getByRole('button', { name: 'Remove Meleys' }))
    expect(
      within(section).getByText(
        'Remove Meleys? This signs raven player out of it and deletes its 1 download.',
      ),
    ).toBeInTheDocument()
  })

  it('says nothing of downloads when the server has none', async () => {
    const { section } = await renderServers({
      downloads: [viewOf({ downloadId: DL_1, serverId: T })],
    })
    await userEvent.click(await within(section).findByRole('button', { name: 'Remove Meleys' }))
    expect(
      await within(section).findByText(
        'Remove Meleys? This signs raven player out of it and deletes its 1 download.',
      ),
    ).toBeInTheDocument()
    await userEvent.click(within(section).getByRole('button', { name: 'Keep' }))
    await userEvent.click(within(section).getByRole('button', { name: 'Remove Vhagar' }))
    expect(
      within(section).getByText('Remove Vhagar? This signs raven player out of it.'),
    ).toBeInTheDocument()
  })

  it('removes a server and says it signed out of it', async () => {
    const { section, client, queryClient } = await renderServers()
    queryClient.setQueryData(RECENTS_KEY, [])
    await removeFrom({ section, name: 'Vhagar' })
    expect(sentOf({ client, type: 'removeServer' })).toEqual([
      { type: 'removeServer', serverId: S },
    ])
    await waitFor(() =>
      expect(within(section).getByRole('status')).toHaveTextContent(
        'Removed Vhagar. raven player signed out of it.',
      ),
    )
    await waitFor(() => expect(within(section).getAllByRole('listitem')).toHaveLength(1))
    expect(within(section).queryByText('Vhagar')).toBeNull()
    expect(queryClient.getQueryState(RECENTS_KEY)?.isInvalidated ?? false).toBe(true)
    expect(within(section).getByRole('heading', { name: 'Servers' })).toHaveFocus()
  })

  it('says so when main still lists the server it was asked to remove', async () => {
    const { section } = await renderServers({
      answers: { removeServer: { type: 'servers', servers: [VHAGAR, MELEYS] } },
    })
    await removeFrom({ section, name: 'Vhagar' })
    const alert = await within(section).findByRole('alert')
    expect(alert).toHaveTextContent('raven player could not remove Vhagar. Try again.')
    expect(alert).toHaveAttribute('data-refused', 'true')
    expect(within(section).getByRole('status')).toHaveTextContent('')
    const remove = within(section).getByRole('button', { name: 'Remove Vhagar' })
    expect(remove).toHaveFocus()
    expect(remove).toHaveAccessibleDescription('raven player could not remove Vhagar. Try again.')
    expect(within(section).getByRole('button', { name: 'Remove Meleys' })).not.toHaveAttribute(
      'aria-describedby',
    )
  })

  it("ties main's refusal of a removal to the Remove button it answers", async () => {
    const { section } = await renderServers({
      answers: { removeServer: { type: 'refused', message: 'raven player is busy.' } },
    })
    await removeFrom({ section, name: 'Vhagar' })
    await within(section).findByRole('alert')
    const row = await rowOf({ section, name: 'Remove Vhagar? This signs raven player out of it.' })
    expect(within(row).getByRole('button', { name: 'Remove' })).toHaveAccessibleDescription(
      'Remove Vhagar? This signs raven player out of it. raven player is busy.',
    )
  })

  it('says a server is already there when adding it changes nothing', async () => {
    const { section } = await renderServers({
      answers: { addServer: { type: 'servers', servers: [VHAGAR, MELEYS] } },
    })
    await userEvent.type(
      within(section).getByRole('textbox', { name: 'Server address' }),
      'https://raven.example/',
    )
    await userEvent.click(within(section).getByRole('button', { name: 'Add server' }))
    await waitFor(() =>
      expect(within(section).getByRole('status')).toHaveTextContent(
        'That server is already in raven player.',
      ),
    )
    expect(within(section).queryByRole('alert')).toBeNull()
  })

  it('labels the add field and adds a server, clearing the field', async () => {
    const { section, client } = await renderServers()
    const field = within(section).getByRole('textbox', { name: 'Server address' })
    expect(field).toHaveAttribute('type', 'url')
    expect(field).toHaveAttribute('placeholder', 'https://raven.example.ts.net')
    await userEvent.type(field, '  https://raven.example.ts.net ')
    await userEvent.click(within(section).getByRole('button', { name: 'Add server' }))
    expect(sentOf({ client, type: 'addServer' })).toEqual([
      { type: 'addServer', origin: 'https://raven.example.ts.net' },
    ])
    await waitFor(() =>
      expect(within(section).getByRole('status')).toHaveTextContent('Server added.'),
    )
    expect(await within(section).findByText('raven.example.ts.net')).toBeInTheDocument()
    expect(field).toHaveValue('')
  })

  it('says nothing when the person declines the prompt, and keeps what they typed', async () => {
    const { section, client } = await renderServers({
      answers: { addServer: { type: DESKTOP_REPLIES.done } },
    })
    const field = within(section).getByRole('textbox', { name: 'Server address' })
    await userEvent.type(field, 'https://raven.example')
    await userEvent.click(within(section).getByRole('button', { name: 'Add server' }))
    await waitFor(() => expect(sentOf({ client, type: 'addServer' })).toHaveLength(1))
    await waitFor(() =>
      expect(within(section).getByRole('button', { name: 'Add server' })).toHaveAttribute(
        'aria-disabled',
        'false',
      ),
    )
    expect(within(section).getByRole('status')).toHaveTextContent('')
    expect(within(section).queryByRole('alert')).toBeNull()
    expect(field).toHaveValue('https://raven.example')
  })

  it('says why an add was refused, as an alert', async () => {
    const { section } = await renderServers({
      answers: {
        addServer: { type: 'refused', message: 'raven player keeps at most 20 servers.' },
      },
    })
    await userEvent.type(
      within(section).getByRole('textbox', { name: 'Server address' }),
      'https://raven.example',
    )
    await userEvent.click(within(section).getByRole('button', { name: 'Add server' }))
    const alert = await within(section).findByRole('alert')
    expect(alert).toHaveTextContent('raven player keeps at most 20 servers.')
    expect(alert).toHaveAttribute('data-refused', 'true')
    expect(within(section).getByRole('status')).toHaveTextContent('')
    const field = within(section).getByRole('textbox', { name: 'Server address' })
    await waitFor(() => expect(field).toHaveFocus())
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('raven player keeps at most 20 servers.')
  })

  it('holds Add server while main answers, keeping focus on it, so one press asks once', async () => {
    const held = Promise.withResolvers<DesktopReply>()
    const client = fakeClient({
      request: async (asked) => {
        if (asked.type === DESKTOP_REQUESTS.listServers)
          return { type: 'servers', servers: [VHAGAR] }
        if (asked.type === DESKTOP_REQUESTS.addServer) return held.promise
        return { type: DESKTOP_REPLIES.done }
      },
    })
    renderDesktop({ client, route: '/settings' })
    const section = await screen.findByRole('region', { name: 'Servers' })
    await userEvent.type(
      within(section).getByRole('textbox', { name: 'Server address' }),
      'https://raven.example',
    )
    const button = within(section).getByRole('button', { name: 'Add server' })
    await userEvent.click(button)
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'))
    await userEvent.click(button)
    expect(button).toHaveFocus()
    expect(sentOf({ client, type: 'addServer' })).toHaveLength(1)
    await act(async () => held.resolve({ type: DESKTOP_REPLIES.done }))
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'false'))
  })

  it('asks main again on the next Add after a busy answer', async () => {
    const { section, client } = await renderServers({
      answers: {
        addServer: {
          type: 'refused',
          message: 'raven player is already asking about another server.',
        },
      },
    })
    await userEvent.type(
      within(section).getByRole('textbox', { name: 'Server address' }),
      'https://raven.example',
    )
    const button = within(section).getByRole('button', { name: 'Add server' })
    await userEvent.click(button)
    await within(section).findByRole('alert')
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'false'))
    await userEvent.click(button)
    await waitFor(() => expect(sentOf({ client, type: 'addServer' })).toHaveLength(2))
  })

  it('says so when main does not answer at all', async () => {
    const client = fakeClient({
      request: async (asked) => {
        if (asked.type === DESKTOP_REQUESTS.listServers)
          return { type: 'servers', servers: [VHAGAR] }
        if (asked.type === DESKTOP_REQUESTS.removeServer) throw new Error('port closed')
        return { type: DESKTOP_REPLIES.done }
      },
    })
    renderDesktop({ client, route: '/settings' })
    const section = await screen.findByRole('region', { name: 'Servers' })
    await removeFrom({ section, name: 'Vhagar' })
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'raven player could not change its servers. Try again.',
    )
  })

  it('clears the last alert on the next change', async () => {
    const { section } = await renderServers({
      answers: { addServer: { type: 'refused', message: 'Not now.' } },
    })
    await userEvent.type(
      within(section).getByRole('textbox', { name: 'Server address' }),
      'https://raven.example',
    )
    await userEvent.click(within(section).getByRole('button', { name: 'Add server' }))
    await within(section).findByRole('alert')
    await removeFrom({ section, name: 'Vhagar' })
    await waitFor(() => expect(within(section).queryByRole('alert')).toBeNull())
    await waitFor(() =>
      expect(within(section).getByRole('status')).toHaveTextContent('Removed Vhagar.'),
    )
  })

  it('keeps its status region mounted and empty until there is something to say', async () => {
    const { section } = await renderServers()
    const status = within(section).getByRole('status')
    expect(status.tagName).toBe('OUTPUT')
    expect(status).toHaveTextContent('')
  })

  it('says so when the servers cannot be read', async () => {
    const client = fakeClient({
      request: async (asked) =>
        asked.type === DESKTOP_REQUESTS.listServers
          ? { type: 'refused', message: 'raven player could not read its servers.' }
          : { type: DESKTOP_REPLIES.done },
    })
    renderDesktop({ client, route: '/settings' })
    const section = await screen.findByRole('region', { name: 'Servers' })
    expect(
      await within(section).findByText('raven player could not read its servers.'),
    ).toBeInTheDocument()
  })
})

const ME = 'me@example.com'

const approved = (overrides: Partial<AccountView> = {}) =>
  accountOf({ state: ACCOUNT_STATES.approved, email: ME, ...overrides })

describe('Servers accounts', () => {
  it('shows who is signed in and a Sign out for a ready server', async () => {
    const { section } = await renderServers({ servers: [VHAGAR], accounts: [approved()] })
    const row = await rowOf({ section, name: 'Vhagar' })
    expect(await within(row).findByText(`Signed in as ${ME}.`)).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Sign out of Vhagar' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Sign in to Vhagar' })).toBeNull()
  })

  it('offers Sign in for a signed out server, and opens the form in its row', async () => {
    const { section } = await renderServers({ servers: [VHAGAR], accounts: [accountOf()] })
    const row = await rowOf({ section, name: 'Vhagar' })
    expect(await within(row).findByText('Not signed in.')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Sign in to Vhagar' }))
    expect(within(row).getByLabelText('Email')).toHaveFocus()
    expect(within(row).getByLabelText('Password')).toBeInTheDocument()
    expect(within(row).getByText('Signs in with project.supabase.co.')).toBeInTheDocument()
  })

  it('signs in from the row and then shows the email with Sign out', async () => {
    const { section, client } = await renderServers({
      servers: [VHAGAR],
      accounts: [accountOf()],
    })
    const row = await rowOf({ section, name: 'Vhagar' })
    await userEvent.click(await within(row).findByRole('button', { name: 'Sign in to Vhagar' }))
    await userEvent.type(within(row).getByLabelText('Email'), ME)
    await userEvent.type(within(row).getByLabelText('Password'), 'hunter2')
    await userEvent.click(within(row).getByRole('button', { name: 'Sign in' }))
    expect(await within(row).findByText(`Signed in as ${ME}.`)).toBeInTheDocument()
    expect(within(row).queryByLabelText('Password')).toBeNull()
    expect(sentOf({ client, type: DESKTOP_REQUESTS.signIn })).toEqual([
      { type: DESKTOP_REQUESTS.signIn, serverId: S, email: ME, password: 'hunter2' },
    ])
    expect(within(row).getByRole('button', { name: 'Sign out of Vhagar' })).toHaveFocus()
  })

  it('says why a sign in was refused and keeps the form open', async () => {
    const { section } = await renderServers({
      servers: [VHAGAR],
      accounts: [accountOf()],
      answers: {
        signIn: { type: DESKTOP_REPLIES.refused, message: 'Email or password is wrong.' },
      },
    })
    const row = await rowOf({ section, name: 'Vhagar' })
    await userEvent.click(await within(row).findByRole('button', { name: 'Sign in to Vhagar' }))
    await userEvent.type(within(row).getByLabelText('Email'), ME)
    await userEvent.type(within(row).getByLabelText('Password'), 'nope')
    await userEvent.click(within(row).getByRole('button', { name: 'Sign in' }))
    expect(await within(row).findByRole('alert')).toHaveTextContent('Email or password is wrong.')
    expect(within(row).getByLabelText('Password')).toHaveValue('')
  })

  it('closes the form on Cancel and puts focus back on Sign in', async () => {
    const { section } = await renderServers({ servers: [VHAGAR], accounts: [accountOf()] })
    const row = await rowOf({ section, name: 'Vhagar' })
    await userEvent.click(await within(row).findByRole('button', { name: 'Sign in to Vhagar' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Cancel' }))
    expect(within(row).queryByLabelText('Password')).toBeNull()
    expect(within(row).getByRole('button', { name: 'Sign in to Vhagar' })).toHaveFocus()
  })

  it('signs out from the row and goes back to Sign in', async () => {
    const { section, client } = await renderServers({
      servers: [VHAGAR],
      accounts: [approved()],
    })
    const row = await rowOf({ section, name: 'Vhagar' })
    await userEvent.click(await within(row).findByRole('button', { name: 'Sign out of Vhagar' }))
    expect(await within(row).findByText('Not signed in.')).toBeInTheDocument()
    expect(sentOf({ client, type: DESKTOP_REQUESTS.signOut })).toEqual([
      { type: DESKTOP_REQUESTS.signOut, serverId: S },
    ])
    expect(within(row).getByRole('button', { name: 'Sign in to Vhagar' })).toHaveFocus()
  })

  it('shows a pending account as waiting for approval, and re-renders once it is approved', async () => {
    const { section } = await renderServers({
      servers: [VHAGAR],
      accounts: [approved({ state: ACCOUNT_STATES.pending })],
      answers: { refreshAccount: { type: DESKTOP_REPLIES.account, account: approved() } },
    })
    const row = await rowOf({ section, name: 'Vhagar' })
    expect(await within(row).findByText('Waiting for approval')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Check again' }))
    expect(await within(row).findByText(`Signed in as ${ME}.`)).toBeInTheDocument()
    expect(within(row).queryByText('Waiting for approval')).toBeNull()
  })

  it('shows a removed account as removed', async () => {
    const { section } = await renderServers({
      servers: [VHAGAR],
      accounts: [approved({ state: ACCOUNT_STATES.revoked })],
    })
    const row = await rowOf({ section, name: 'Vhagar' })
    expect(await within(row).findByText('Your access was removed')).toBeInTheDocument()
  })

  it('says accounts are unavailable on a server that cannot take them right now, and checks again', async () => {
    const { section, client } = await renderServers({
      servers: [VHAGAR],
      accounts: [accountOf({ state: ACCOUNT_STATES.unavailable, signInHost: null })],
      answers: { refreshAccount: { type: DESKTOP_REPLIES.account, account: approved() } },
    })
    const row = await rowOf({ section, name: 'Vhagar' })
    expect(
      await within(row).findByText('Accounts are unavailable on Vhagar right now.'),
    ).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /^Sign in/ })).toBeNull()
    await userEvent.click(within(row).getByRole('button', { name: 'Check again' }))
    expect(await within(row).findByText(`Signed in as ${ME}.`)).toBeInTheDocument()
    expect(sentOf({ client, type: DESKTOP_REQUESTS.refreshAccount })).toHaveLength(1)
  })

  it('offers Check again when main could not tell the account', async () => {
    const { section, client } = await renderServers({
      servers: [VHAGAR],
      accounts: [accountOf({ state: ACCOUNT_STATES.failed })],
      answers: { refreshAccount: { type: DESKTOP_REPLIES.account, account: approved() } },
    })
    const row = await rowOf({ section, name: 'Vhagar' })
    expect(
      await within(row).findByText('raven player could not check your account on Vhagar.'),
    ).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Check again' }))
    expect(await within(row).findByText(`Signed in as ${ME}.`)).toBeInTheDocument()
    expect(sentOf({ client, type: DESKTOP_REQUESTS.refreshAccount })).toHaveLength(1)
  })

  it('shows nothing new for a server with accounts off, or one too old to have them', async () => {
    const { section } = await renderServers({
      servers: [VHAGAR],
      accounts: [accountOf({ state: ACCOUNT_STATES.off, signInHost: null })],
    })
    const row = await rowOf({ section, name: 'Vhagar' })
    await waitFor(() => expect(within(row).queryByText('Not signed in.')).toBeNull())
    expect(within(row).queryByRole('button', { name: /^Sign (in|out)/ })).toBeNull()
    expect(within(row).getAllByRole('button')).toHaveLength(2)
  })

  it('shows nothing new for a server main has no account for (an older server)', async () => {
    const { section } = await renderServers({ servers: [VHAGAR] })
    const row = await rowOf({ section, name: 'Vhagar' })
    expect(within(row).getAllByRole('button')).toHaveLength(2)
    expect(within(row).queryByText('Not signed in.')).toBeNull()
  })

  it('keeps one server signed in while another is not', async () => {
    const { section } = await renderServers({
      accounts: [approved(), accountOf({ serverId: T })],
    })
    const vhagar = await rowOf({ section, name: 'Vhagar' })
    const meleys = await rowOf({ section, name: 'Meleys' })
    expect(await within(vhagar).findByText(`Signed in as ${ME}.`)).toBeInTheDocument()
    expect(await within(meleys).findByText('Not signed in.')).toBeInTheDocument()
  })
})
