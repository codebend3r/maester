import { describe, expect, it } from 'bun:test'
import { DESKTOP_REPLIES, DESKTOP_REQUESTS, type DesktopRequest } from '@raven/core'
import { useActiveServer } from '@raven/ui/headless'
import {
  DESKTOP_SERVER_ERRORS,
  desktopReadsOf,
  followActiveServerInMain,
  isRelayedByMain,
  mainOnActiveServer,
} from '@/desktop/servers'
import { useAuthSession } from '@/stores/authSession'
import { asDesktop, fakeClient } from '@/test/desktop'
import { library } from '@/test/fixtures'

const serverOf = (n: number) => ({
  serverId: `0e000000-0000-4000-8000-00000000000${n}`,
  origin: `https://server-${n}.example`,
})

const usesOf = (requests: readonly DesktopRequest[]): (string | null)[] =>
  requests.flatMap((request) =>
    request.type === DESKTOP_REQUESTS.useServer ? [request.serverId] : [],
  )

describe('mainOnActiveServer', () => {
  it('settles at once outside Raven, asking nothing', async () => {
    expect(isRelayedByMain()).toBe(false)
    await mainOnActiveServer()
  })

  it('asks main once for each server the page switches to, by its id alone', async () => {
    const client = fakeClient()
    asDesktop(client)
    expect(isRelayedByMain()).toBe(true)
    const one = serverOf(1)
    useActiveServer.getState().choose(one)
    await mainOnActiveServer()
    await mainOnActiveServer()
    useActiveServer.getState().choose(null)
    await mainOnActiveServer()
    const sent = client.request.mock.calls.map(([request]) => request)
    expect(usesOf(sent)).toEqual([one.serverId, null])
    expect(JSON.stringify(sent)).not.toContain(one.origin)
  })

  it('goes home when main will not use the server, as main has', async () => {
    const answers = [
      { type: DESKTOP_REPLIES.refused, message: 'Raven could not reach that server.' },
      { type: DESKTOP_REPLIES.done },
    ] as const
    const replies = [...answers]
    const client = fakeClient({ request: async () => replies.shift() ?? answers[1] })
    asDesktop(client)
    const two = serverOf(2)
    useActiveServer.getState().choose(two)
    await expect(mainOnActiveServer()).rejects.toThrow(DESKTOP_SERVER_ERRORS.notUsed)
    expect(useActiveServer.getState().active).toBeNull()
    await mainOnActiveServer()
    expect(usesOf(client.request.mock.calls.map(([request]) => request))).toEqual([
      two.serverId,
      null,
    ])
  })
})

describe('followActiveServerInMain', () => {
  it('tells main of the server the page was left on, then of each switch', async () => {
    const three = serverOf(3)
    const four = serverOf(4)
    useActiveServer.getState().choose(three)
    const client = fakeClient()
    asDesktop(client)
    const stop = followActiveServerInMain()
    useActiveServer.getState().choose(four)
    stop()
    useActiveServer.getState().choose(null)
    await Promise.resolve()
    expect(usesOf(client.request.mock.calls.map(([request]) => request))).toEqual([
      three.serverId,
      four.serverId,
    ])
  })
})

describe('following main home', () => {
  const signedIn = (userId: string) => ({ accessToken: `token-${userId}`, userId })

  it('goes home with main when the account signs out or another signs in, and asks main again', async () => {
    const eight = serverOf(8)
    useAuthSession.setState({ session: signedIn('one') })
    useActiveServer.getState().choose(eight)
    const client = fakeClient()
    asDesktop(client)
    const stop = followActiveServerInMain()
    await mainOnActiveServer()
    useAuthSession.setState({ session: signedIn('two') })
    expect(useActiveServer.getState().active).toBeNull()
    useActiveServer.getState().choose(eight)
    useAuthSession.setState({ session: null })
    expect(useActiveServer.getState().active).toBeNull()
    await mainOnActiveServer()
    stop()
    expect(usesOf(client.request.mock.calls.map(([request]) => request))).toEqual([
      eight.serverId,
      null,
      eight.serverId,
      null,
    ])
  })

  it('stays where the page was left on a first sign in', () => {
    const nine = serverOf(9)
    useAuthSession.setState({ session: null })
    useActiveServer.getState().choose(nine)
    asDesktop(fakeClient())
    const stop = followActiveServerInMain()
    useAuthSession.setState({ session: signedIn('one') })
    stop()
    expect(useActiveServer.getState().active).toEqual(nine)
  })
})

describe("main's reads of other servers", () => {
  it("reads another server's libraries through main", async () => {
    const libraries = [library({ id: 3 })]
    const client = fakeClient({
      request: async () => ({ type: DESKTOP_REPLIES.libraries, libraries }),
    })
    const five = serverOf(5)
    expect(
      await desktopReadsOf(client)
        .librariesOf({ serverId: five.serverId, apiBase: '' })
        .listLibraries(),
    ).toEqual(libraries)
    expect(client.request.mock.calls[0]?.[0] ?? null).toEqual({
      type: DESKTOP_REQUESTS.serverLibraries,
      serverId: five.serverId,
    })
  })

  it("fails a library read main refuses in main's words", async () => {
    const client = fakeClient({
      request: async () => ({ type: DESKTOP_REPLIES.refused, message: 'Not on your account.' }),
    })
    await expect(
      desktopReadsOf(client)
        .librariesOf({ serverId: serverOf(6).serverId, apiBase: '' })
        .listLibraries(),
    ).rejects.toThrow('Not on your account.')
  })

  it("reads a new server's id from its health through main, and nothing when it does not answer", async () => {
    const seven = serverOf(7)
    const answering = fakeClient({
      request: async () => ({ type: DESKTOP_REPLIES.server, serverId: seven.serverId }),
    })
    expect(await desktopReadsOf(answering).healthIdAt(seven.origin)).toEqual({
      serverId: seven.serverId,
    })
    const silent = fakeClient({
      request: async () => ({ type: DESKTOP_REPLIES.refused, message: 'unreachable' }),
    })
    expect(await desktopReadsOf(silent).healthIdAt(seven.origin)).toBeNull()
  })
})
