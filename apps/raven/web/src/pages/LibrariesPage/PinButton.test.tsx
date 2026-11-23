import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useActiveServer } from '@raven/ui/headless'
import { api } from '@/lib/api'
import { accountDataFor } from '@/lib/accountData'
import { LibrariesPage } from '@/pages/LibrariesPage/LibrariesPage'
import { HOME_ID, fakeAccount, readyConfig } from '@/test/authClient'
import { library } from '@/test/fixtures'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'
import { MELEYS_ID, MELEYS_ORIGIN, pin } from '@/test/servers'

/** Opens every card, which start folded, once the libraries are there. */
const openAll = async () => {
  const toggles = await screen.findAllByRole('button', { name: /^Expand / })
  await toggles.reduce(
    (done, toggle) => done.then(() => userEvent.click(toggle)),
    Promise.resolve(),
  )
}

describe('the Pin toggle on the Libraries page', () => {
  const accountData = accountDataFor(readyConfig)
  const spies = {
    list: spyOn(api, 'listLibraries'),
    lock: spyOn(api, 'getLock'),
    pins: spyOn(accountData, 'listPins'),
    pinLibrary: spyOn(accountData, 'pinLibrary'),
    unpinLibrary: spyOn(accountData, 'unpinLibrary'),
    servers: spyOn(accountData, 'listServers'),
  }

  beforeEach(() => {
    spies.list.mockImplementation(async () => [
      library({ id: 1, name: 'Films' }),
      library({ id: 2, name: 'Clips' }),
    ])
    spies.lock.mockImplementation(async () => ({ available: false, unlocked: false }))
    spies.pins.mockImplementation(async () => [pin({ libraryId: 1 })])
    spies.pinLibrary.mockImplementation(async () => undefined)
    spies.unpinLibrary.mockImplementation(async () => undefined)
    spies.servers.mockImplementation(async () => [])
  })

  afterEach(() => Object.values(spies).forEach((spy) => spy.mockReset()))

  afterAll(() => Object.values(spies).forEach((spy) => spy.mockRestore()))

  const renderSignedIn = () =>
    renderWithProviders({ ui: <LibrariesPage />, account: fakeAccount({ isOwner: true }) })

  it('reads Pinned on a library the account pinned on this server and Pin on one it did not', async () => {
    renderSignedIn()
    await openAll()
    const pinned = await screen.findByRole('button', { name: 'Pin Films' })
    await waitFor(() => expect(pinned).toHaveAttribute('aria-pressed', 'true'))
    const unpinned = screen.getByRole('button', { name: 'Pin Clips' })
    expect(unpinned).toHaveAttribute('aria-pressed', 'false')
    expect(within(pinned).getByText('Pinned')).toHaveAttribute('aria-hidden', 'true')
    expect(within(unpinned).getByText('Pin')).toHaveAttribute('aria-hidden', 'true')
  })

  it("pins at once, before the account's database answers, for this server and library", async () => {
    spies.pinLibrary.mockImplementation(() => held<undefined>().promise)
    renderSignedIn()
    await openAll()
    const clips = await screen.findByRole('button', { name: 'Pin Clips' })
    await userEvent.click(clips)
    await waitFor(() => expect(clips).toHaveAttribute('aria-pressed', 'true'))
    expect(spies.pinLibrary).toHaveBeenCalledWith({ serverId: HOME_ID, libraryId: 2 })
  })

  it('unpins a pinned library', async () => {
    renderSignedIn()
    await openAll()
    const films = await screen.findByRole('button', { name: 'Pin Films' })
    await waitFor(() => expect(films).toHaveAttribute('aria-pressed', 'true'))
    await userEvent.click(films)
    expect(spies.unpinLibrary).toHaveBeenCalledWith({ serverId: HOME_ID, libraryId: 1 })
  })

  it('takes the pin back when the database refuses it', async () => {
    spies.pinLibrary.mockImplementation(async () => {
      throw new Error('The database is away.')
    })
    renderSignedIn()
    await openAll()
    const clips = await screen.findByRole('button', { name: 'Pin Clips' })
    await userEvent.click(clips)
    await waitFor(() => expect(clips).toHaveAttribute('aria-pressed', 'false'))
  })

  it('pins for the server in use when it is not the home one', async () => {
    useActiveServer.getState().choose({ serverId: MELEYS_ID, origin: MELEYS_ORIGIN })
    renderSignedIn()
    await openAll()
    const films = await screen.findByRole('button', { name: 'Pin Films' })
    // The account's pin of Films is home's, not this server's.
    expect(films).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(films)
    expect(spies.pinLibrary).toHaveBeenCalledWith({ serverId: MELEYS_ID, libraryId: 1 })
  })

  it("offers no Pin with accounts off, since pins are the account's", async () => {
    renderWithProviders({ ui: <LibrariesPage /> })
    await openAll()
    await screen.findByRole('button', { name: 'Edit Films' })
    expect(screen.queryByRole('button', { name: /^Pin / })).toBeNull()
  })
})
