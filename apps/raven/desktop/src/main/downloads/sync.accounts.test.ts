import { describe, expect, it } from 'bun:test'
import { oweOtherAccounts, type Pending } from '@/main/downloads/downloadState'
import { SYNC_DEBOUNCE_MS } from '@/main/downloads/sync'
import { CALL_NAMES, type AllowedCall } from '@/main/servers/allowlist'
import { ticks } from '@/main/test/downloadFakes'
import { entryFor, gate, ID, NO_CONTENT, NOW, SERVER_ID, setupSync } from '@/main/test/syncWorld'

describe('what an account watched', () => {
  const ACCOUNT_A = '30000000-0000-4000-8000-00000000000a'
  const ACCOUNT_B = '30000000-0000-4000-8000-00000000000b'
  const asA: Pending = { play: true, position: 300, furthest: 300, at: NOW, accountId: ACCOUNT_A }
  const asB: Pending = { ...asA, position: 40, furthest: 40, accountId: ACCOUNT_B }
  const playOf = (mediaId: number): AllowedCall => ({ name: CALL_NAMES.recordPlay, mediaId })
  const progressOf = ({
    mediaId,
    position,
  }: {
    mediaId: number
    position: number
  }): AllowedCall => ({
    name: CALL_NAMES.saveProgress,
    mediaId,
    position,
  })

  it('sends nothing of an account while it is signed out or another is signed in, then all of it once', async () => {
    const world = setupSync({
      entries: [entryFor({ pending: asA })],
      owed: [{ serverId: SERVER_ID, mediaId: 12, pending: asA }],
    })
    await world.sync.runAll()
    world.signedIn.accountId = ACCOUNT_B
    await world.sync.runAll()
    expect(world.log).toEqual([])
    expect(world.pending.size).toBe(0)
    world.signedIn.accountId = ACCOUNT_A
    await world.sync.runAll()
    await world.sync.runAll()
    expect(world.log).toEqual([
      playOf(11),
      progressOf({ mediaId: 11, position: 300 }),
      playOf(12),
      progressOf({ mediaId: 12, position: 300 }),
    ])
    expect(world.store.read().owed).toEqual([])
  })

  it('sends what was noted for no account to whoever is signed in', async () => {
    const world = setupSync({
      entries: [entryFor({ pending: { ...asA, accountId: null } })],
      accountId: ACCOUNT_B,
    })
    await world.sync.runAll()
    expect(world.log).toEqual([playOf(11), progressOf({ mediaId: 11, position: 300 })])
  })

  it("sends only the signed in account's owed item of a title two accounts watched", async () => {
    const world = setupSync({
      entries: [],
      owed: [
        { serverId: SERVER_ID, mediaId: 11, pending: asA },
        { serverId: SERVER_ID, mediaId: 11, pending: asB },
      ],
      accountId: ACCOUNT_B,
    })
    await world.sync.runAll()
    expect(world.log).toEqual([playOf(11), progressOf({ mediaId: 11, position: 40 })])
    expect(world.store.read().owed).toEqual([{ serverId: SERVER_ID, mediaId: 11, pending: asA }])
  })

  it('keeps an item whose call found another account signed in waiting, and the server reachable', async () => {
    const world = setupSync({ entries: [entryFor({ pending: asA })], accountId: ACCOUNT_A })
    const held = gate()
    world.server.answer = () => held.answer
    const running = world.sync.runAll()
    await ticks(3)
    world.signedIn.accountId = ACCOUNT_B
    held.open({ ok: false, message: 'raven player is signed in to Vhagar as someone else now.' })
    await running
    expect(world.pendingOf()).toEqual(asA)
    expect(world.pending.size).toBe(0)
    world.server.answer = async () => NO_CONTENT
    world.store.update((state) =>
      oweOtherAccounts(state, { serverId: SERVER_ID, accountId: ACCOUNT_B }),
    )
    world.note({ position: 40 })
    world.fireAt(SYNC_DEBOUNCE_MS)
    await ticks(5)
    expect(world.log).toEqual([playOf(11), progressOf({ mediaId: 11, position: 40 })])
    expect(world.asked.at(-1) ?? null).toBe(ACCOUNT_B)
  })

  it("stops a send whose account signed out between its calls, and clears no other account's play", async () => {
    const world = setupSync({ accountId: ACCOUNT_A })
    const held = gate()
    world.server.answer = (call) =>
      call.name === CALL_NAMES.recordPlay ? held.answer : Promise.resolve(NO_CONTENT)
    world.note({ play: true, position: 300 })
    const running = world.sync.runFor({ downloadIds: [ID] })
    await ticks(3)
    world.signedIn.accountId = ACCOUNT_B
    world.store.update((state) =>
      oweOtherAccounts(state, { serverId: SERVER_ID, accountId: ACCOUNT_B }),
    )
    world.note({ play: true, position: 40 })
    held.open(NO_CONTENT)
    await running
    expect(world.log).toEqual([playOf(11)])
    expect(world.pendingOf()).toEqual({
      play: true,
      position: 40,
      furthest: 40,
      at: NOW,
      accountId: ACCOUNT_B,
    })
    expect(world.store.read().owed).toEqual([
      { serverId: SERVER_ID, mediaId: 11, pending: { ...asA, play: false } },
    ])
  })
})
