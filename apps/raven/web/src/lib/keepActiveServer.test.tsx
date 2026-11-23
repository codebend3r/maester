import { afterAll, afterEach, describe, expect, it, spyOn } from 'bun:test'
import { act, waitFor } from '@testing-library/react'
import { useActiveServer } from '@raven/ui/headless'
import { KeepActiveServer } from '@/lib/keepActiveServer'
import { accountDataFor } from '@/lib/accountData'
import { fakeAccount, readyConfig } from '@/test/authClient'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'
import { useAuthSession } from '@/stores/authSession'
import { MELEYS_ID, MELEYS_ORIGIN, meleysRow } from '@/test/servers'

const MELEYS = { serverId: MELEYS_ID, origin: MELEYS_ORIGIN } as const

describe('KeepActiveServer', () => {
  const listServers = spyOn(accountDataFor(readyConfig), 'listServers')

  afterEach(() => listServers.mockReset())

  afterAll(() => listServers.mockRestore())

  it('stays on a server the account still keeps', async () => {
    listServers.mockImplementation(async () => [meleysRow()])
    useActiveServer.getState().choose(MELEYS)
    renderWithProviders({ ui: <KeepActiveServer />, account: fakeAccount() })
    await waitFor(() => expect(listServers).toHaveBeenCalled())
    expect(useActiveServer.getState().active).toEqual(MELEYS)
  })

  it('stays put until the list is read', () => {
    listServers.mockImplementation(() => held<never>().promise)
    useActiveServer.getState().choose(MELEYS)
    renderWithProviders({ ui: <KeepActiveServer />, account: fakeAccount() })
    expect(useActiveServer.getState().active).toEqual(MELEYS)
  })

  it('goes home once the server it was on is off the list, removed on another device', async () => {
    listServers.mockImplementation(async () => [])
    useActiveServer.getState().choose(MELEYS)
    renderWithProviders({ ui: <KeepActiveServer />, account: fakeAccount() })
    await waitFor(() => expect(useActiveServer.getState().active).toBeNull())
  })

  it('goes home when the account signs out, as Raven main does', async () => {
    listServers.mockImplementation(async () => [meleysRow()])
    useActiveServer.getState().choose(MELEYS)
    renderWithProviders({ ui: <KeepActiveServer />, account: fakeAccount() })
    await waitFor(() => expect(listServers).toHaveBeenCalled())
    act(() => useAuthSession.setState({ session: null }))
    expect(useActiveServer.getState().active).toBeNull()
  })

  it('goes home when another account signs in, even one that keeps the same server', async () => {
    listServers.mockImplementation(async () => [meleysRow()])
    useActiveServer.getState().choose(MELEYS)
    renderWithProviders({ ui: <KeepActiveServer />, account: fakeAccount() })
    await waitFor(() => expect(listServers).toHaveBeenCalled())
    act(() => useAuthSession.setState({ session: { accessToken: 't2', userId: 'another' } }))
    expect(useActiveServer.getState().active).toBeNull()
  })

  it('goes home with accounts off, where there is no list to keep it on', async () => {
    useActiveServer.getState().choose(MELEYS)
    renderWithProviders({ ui: <KeepActiveServer /> })
    await waitFor(() => expect(useActiveServer.getState().active).toBeNull())
  })
})
