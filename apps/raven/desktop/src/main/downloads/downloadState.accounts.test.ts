import { describe, expect, it } from 'bun:test'
import {
  NO_PENDING,
  clearOwed,
  dropOwed,
  notePending,
  owedOf,
  oweOtherAccounts,
  queue,
  remove,
  type Pending,
} from '@/main/downloads/downloadState'
import { entry, id, SERVER_A, SERVER_B, stateOf } from '@/main/test/downloadEntries'

const ID = id(1)

describe('pending by account', () => {
  const ACCOUNT_A = '30000000-0000-4000-8000-00000000000a'
  const ACCOUNT_B = '30000000-0000-4000-8000-00000000000b'
  const asA: Pending = { play: true, position: 180, furthest: 190, at: 50, accountId: ACCOUNT_A }
  const keyOfA = { serverId: SERVER_A, mediaId: 1, accountId: ACCOUNT_A }

  it('notePending tags what it notes with the account signed in', () => {
    const next = notePending(stateOf(entry()), {
      downloadId: ID,
      play: true,
      position: 42,
      at: 9,
      accountId: ACCOUNT_A,
    })
    expect(next.entries[0]?.pending ?? null).toEqual({
      play: true,
      position: 42,
      furthest: 42,
      at: 9,
      accountId: ACCOUNT_A,
    })
  })

  it("notePending for another account moves the first account's pending to owed, never folding them", () => {
    const next = notePending(stateOf(entry({ pending: asA })), {
      downloadId: ID,
      play: false,
      position: 20,
      at: 60,
      accountId: ACCOUNT_B,
    })
    expect(next.entries[0]?.pending ?? null).toEqual({
      play: false,
      position: 20,
      furthest: 20,
      at: 60,
      accountId: ACCOUNT_B,
    })
    expect(next.owed).toEqual([{ serverId: SERVER_A, mediaId: 1, pending: asA }])
  })

  it("oweOtherAccounts moves only that server's pending of other accounts to owed", () => {
    const shared: Pending = { ...asA, accountId: null }
    const asB: Pending = { ...asA, accountId: ACCOUNT_B }
    const state = stateOf(
      entry({ downloadId: id(1), mediaId: 1, pending: asA }),
      entry({ downloadId: id(2), mediaId: 2, pending: asB }),
      entry({ downloadId: id(3), mediaId: 3, pending: shared }),
      entry({ downloadId: id(4), mediaId: 4, serverId: SERVER_B, pending: asA }),
    )
    const next = oweOtherAccounts(state, { serverId: SERVER_A, accountId: ACCOUNT_B })
    expect(next.entries.map(({ pending }) => pending)).toEqual([NO_PENDING, asB, shared, asA])
    expect(next.owed).toEqual([{ serverId: SERVER_A, mediaId: 1, pending: asA }])
  })

  it('oweOtherAccounts on a sign out owes every account, and changes nothing when nothing is tagged', () => {
    const state = stateOf(entry({ pending: asA }))
    expect(oweOtherAccounts(state, { serverId: SERVER_A, accountId: null }).owed).toEqual([
      { serverId: SERVER_A, mediaId: 1, pending: asA },
    ])
    const untagged = stateOf(
      entry({ pending: { ...asA, accountId: null } }),
      entry({ downloadId: id(2) }),
    )
    expect(oweOtherAccounts(untagged, { serverId: SERVER_A, accountId: null })).toBe(untagged)
  })

  it("keeps one owed item per title and account, and clears and drops only the account's own", () => {
    const asB: Pending = { ...asA, position: 30, furthest: 30, accountId: ACCOUNT_B }
    const owedA = remove(stateOf(entry({ pending: asA })), { downloadId: ID })
    const both = remove(queue(owedA, { entries: [entry({ downloadId: id(2), pending: asB })] }), {
      downloadId: id(2),
    })
    expect(both.owed).toEqual([
      { serverId: SERVER_A, mediaId: 1, pending: asA },
      { serverId: SERVER_A, mediaId: 1, pending: asB },
    ])
    expect(owedOf(both, keyOfA)?.pending ?? null).toEqual(asA)
    const cleared = clearOwed(both, {
      ...keyOfA,
      sentPlay: true,
      sentPosition: 180,
      sentFurthest: 190,
    })
    expect(cleared.owed).toEqual([{ serverId: SERVER_A, mediaId: 1, pending: asB }])
    expect(dropOwed(both, keyOfA).owed).toEqual([{ serverId: SERVER_A, mediaId: 1, pending: asB }])
  })
})
