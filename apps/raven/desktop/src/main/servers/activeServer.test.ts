import { describe, expect, it } from 'bun:test'
import { DESKTOP_REPLIES } from '@raven/core'
import { HTTP_STATUSES } from '@shared/http'
import { createAccountSignal } from '@/main/accounts/accountSignal'
import type { ServerEntry } from '@/main/desktopConfig'
import { CALL_NAMES } from '@/main/servers/allowlist'
import { ACTIVE_MESSAGES, createActiveServer, SIGN_IN_WAIT_MS } from '@/main/servers/activeServer'
import { createServerCalls, type ServerFetch } from '@/main/servers/serverCalls'
import {
  type Confirmed,
  DIRECTORY_MESSAGES,
  type ServerDirectory,
} from '@/main/servers/serverDirectory'
import { fakeTimers } from '@/main/test/playerFakes'

const HOME: ServerEntry = {
  id: '00000000-0000-4000-8000-0000000000a1',
  origin: 'https://home.example',
}
const FRIEND: ServerEntry = {
  id: '00000000-0000-4000-8000-0000000000b2',
  origin: 'https://friend.example:8443',
}
const STRANGER_ID = '00000000-0000-4000-8000-0000000000c3'

type WorldProps = { isSignedIn?: boolean }

/** The active server over a directory that lists `FRIEND` alone, with its asks held to settle by hand. */
const world = ({ isSignedIn = true }: WorldProps = {}) => {
  const account = { isSignedIn }
  const accountSwitches = createAccountSignal()
  const accessEnds = createAccountSignal()
  const { timers, fire, pending } = fakeTimers()
  const asked: string[] = []
  const held: (() => void)[] = []
  const directory: Pick<ServerDirectory, 'confirm'> = {
    confirm: (serverId) => {
      asked.push(serverId)
      const answer: Confirmed =
        serverId === FRIEND.id
          ? { ok: true, server: FRIEND }
          : { ok: false, message: DIRECTORY_MESSAGES.unlisted }
      return new Promise((resolve) => held.push(() => resolve(answer)))
    },
  }
  const active = createActiveServer({
    home: HOME,
    directory,
    isSignedIn: () => account.isSignedIn,
    accountSwitches,
    accessEnds,
    timers,
  })
  const switches = { count: 0 }
  active.switches.listen(() => {
    switches.count += 1
  })
  const settle = async (): Promise<void> => {
    await Promise.resolve()
    held.splice(0).forEach((resolve) => resolve())
  }
  return { active, asked, settle, switches, account, accountSwitches, accessEnds, fire, pending }
}

describe('createActiveServer', () => {
  it('starts at home', () => {
    const { active } = world()
    expect(active.current()).toEqual(HOME)
    expect(active.isInUse(HOME.id)).toBe(true)
  })

  it("moves to one of the account's servers once the directory confirms it, then back home", async () => {
    const { active, settle, switches } = world()
    const using = active.use(FRIEND.id)
    await settle()
    expect(await using).toEqual({ type: DESKTOP_REPLIES.done })
    expect(active.current()).toEqual(FRIEND)
    expect(active.isInUse(HOME.id)).toBe(false)
    expect(active.isInUse(FRIEND.id)).toBe(true)
    expect(await active.use(null)).toEqual({ type: DESKTOP_REPLIES.done })
    expect(active.current()).toEqual(HOME)
    expect(switches.count).toBe(2)
  })

  it('goes home for a server the directory refuses, so the page can follow it there', async () => {
    const { active, settle, switches } = world()
    const friend = active.use(FRIEND.id)
    await settle()
    await friend
    const using = active.use(STRANGER_ID)
    await settle()
    expect(await using).toEqual({
      type: DESKTOP_REPLIES.refused,
      message: DIRECTORY_MESSAGES.unlisted,
    })
    expect(active.current()).toEqual(HOME)
    expect(switches.count).toBe(2)
  })

  it('changes nothing for a refusal a later ask superseded', async () => {
    const { active, settle } = world()
    const friend = active.use(FRIEND.id)
    await settle()
    await friend
    const refusedAsk = active.use(STRANGER_ID)
    const again = active.use(FRIEND.id)
    await settle()
    expect(await refusedAsk).toEqual({
      type: DESKTOP_REPLIES.refused,
      message: ACTIVE_MESSAGES.superseded,
    })
    expect(await again).toEqual({ type: DESKTOP_REPLIES.done })
    expect(active.current()).toEqual(FRIEND)
  })

  it('asks nothing and tells no one for the server already in use', async () => {
    const { active, asked, switches } = world()
    expect(await active.use(null)).toEqual({ type: DESKTOP_REPLIES.done })
    expect(asked).toEqual([])
    expect(switches.count).toBe(0)
  })

  it('lets the last ask win when the page switches again before the first is confirmed', async () => {
    const { active, settle } = world()
    const first = active.use(FRIEND.id)
    const back = active.use(null)
    await settle()
    expect(await first).toEqual({
      type: DESKTOP_REPLIES.refused,
      message: ACTIVE_MESSAGES.superseded,
    })
    expect(await back).toEqual({ type: DESKTOP_REPLIES.done })
    expect(active.current()).toEqual(HOME)
  })

  it('waits for the page to sign in before it reads the account', async () => {
    const { active, asked, settle, account, accountSwitches, pending } = world({
      isSignedIn: false,
    })
    const using = active.use(FRIEND.id)
    await Promise.resolve()
    expect(asked).toEqual([])
    expect([...pending.values()].map(({ ms }) => ms)).toEqual([SIGN_IN_WAIT_MS])
    account.isSignedIn = true
    accountSwitches.notify()
    await Promise.resolve()
    await settle()
    expect(await using).toEqual({ type: DESKTOP_REPLIES.done })
    expect(asked).toEqual([FRIEND.id])
    expect(pending.size).toBe(0)
  })

  it('asks anyway once the wait for a sign-in runs out', async () => {
    const { active, asked, settle, fire } = world({ isSignedIn: false })
    const using = active.use(FRIEND.id)
    fire()
    await Promise.resolve()
    await settle()
    await using
    expect(asked).toEqual([FRIEND.id])
  })

  it("goes home when the account signed in leaves, so the next one is never sent to the last one's server", async () => {
    const { active, settle, switches, accessEnds } = world()
    const friend = active.use(FRIEND.id)
    await settle()
    await friend
    accessEnds.notify()
    expect(active.current()).toEqual(HOME)
    expect(switches.count).toBe(2)
  })

  it('drops a switch still being confirmed when the account leaves', async () => {
    const { active, settle, accessEnds } = world()
    const using = active.use(FRIEND.id)
    accessEnds.notify()
    await settle()
    expect(await using).toEqual({
      type: DESKTOP_REPLIES.refused,
      message: ACTIVE_MESSAGES.superseded,
    })
    expect(active.current()).toEqual(HOME)
  })

  it('tells no one when the account leaves while home is in use', () => {
    const { active, switches, accessEnds } = world()
    accessEnds.notify()
    expect(active.current()).toEqual(HOME)
    expect(switches.count).toBe(0)
  })

  it("sends main's own calls to the server in use from the moment it switches", async () => {
    const { active, settle } = world()
    const urls: string[] = []
    const fetch: ServerFetch = async ({ url }) => {
      urls.push(url)
      return { status: HTTP_STATUSES.ok, text: async () => '{}' }
    }
    const calls = createServerCalls({
      server: active,
      fetch,
      authorize: () => null,
      unlockOf: async () => null,
      warn: () => undefined,
    })
    await calls.call({ call: { name: CALL_NAMES.getMediaOrigins } })
    const using = active.use(FRIEND.id)
    await settle()
    await using
    await calls.call({ call: { name: CALL_NAMES.getMediaOrigins } })
    expect(urls.map((url) => new URL(url).origin)).toEqual([HOME.origin, FRIEND.origin])
  })
})
