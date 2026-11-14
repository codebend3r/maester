import { describe, expect, it } from 'bun:test'
import {
  clearOwed,
  clearPending,
  dropOwed,
  forgetServerPosition,
  notePending,
  owedOf,
  queue,
  remove,
  removeAll,
  type Pending,
} from '@/main/downloads/downloadState'
import { entry, id, SERVER_A, SERVER_B, stateOf } from '@/main/test/downloadEntries'

const ID = id(1)

describe('what a removed download owes its server', () => {
  const PLAYED: Pending = { play: true, position: 180, furthest: 190, at: 50, accountId: null }
  const owing = stateOf(
    entry({ downloadId: id(1), mediaId: 1, pending: PLAYED }),
    entry({ downloadId: id(2), mediaId: 2, serverId: SERVER_B, pending: PLAYED }),
    entry({ downloadId: id(3), mediaId: 3 }),
  )

  it('remove moves the pending of the entry it drops into owed', () => {
    const next = remove({ state: owing, downloadId: id(1) })
    expect(next.entries.map((each) => each.downloadId)).toEqual([id(2), id(3)])
    expect(next.owed).toEqual([{ serverId: SERVER_A, mediaId: 1, pending: PLAYED }])
  })

  it('remove of an entry with nothing pending owes nothing', () => {
    expect(remove({ state: owing, downloadId: id(3) }).owed).toEqual([])
  })

  it('removeAll moves every pending into owed', () => {
    expect(removeAll(owing).owed).toEqual([
      { serverId: SERVER_A, mediaId: 1, pending: PLAYED },
      { serverId: SERVER_B, mediaId: 2, pending: PLAYED },
    ])
  })

  it('folds a title already owed into one item: the play kept, the newer position, the furthest', () => {
    const first = remove({ state: owing, downloadId: id(1) })
    const again = queue({
      state: first,
      entries: [
        entry({
          downloadId: id(4),
          mediaId: 1,
          pending: { play: false, position: 20, furthest: 40, at: 90, accountId: null },
        }),
      ],
    })
    expect(remove({ state: again, downloadId: id(4) }).owed).toEqual([
      {
        serverId: SERVER_A,
        mediaId: 1,
        pending: { play: true, position: 20, furthest: 190, at: 90, accountId: null },
      },
    ])
  })

  it('folds a title owed a high position with no furthest so the furthest is not below the position', () => {
    const first = remove({
      state: stateOf(
        entry({
          downloadId: id(1),
          mediaId: 1,
          pending: { play: false, position: 180, furthest: null, at: 50, accountId: null },
        }),
      ),
      downloadId: id(1),
    })
    const again = queue({
      state: first,
      entries: [
        entry({
          downloadId: id(4),
          mediaId: 1,
          pending: { play: false, position: null, furthest: 40, at: 90, accountId: null },
        }),
      ],
    })
    expect(remove({ state: again, downloadId: id(4) }).owed).toEqual([
      {
        serverId: SERVER_A,
        mediaId: 1,
        pending: { play: false, position: 180, furthest: 180, at: 90, accountId: null },
      },
    ])
  })

  it('folds a title whose furthest already reaches the position without changing it', () => {
    const first = remove({ state: owing, downloadId: id(1) })
    const again = queue({
      state: first,
      entries: [
        entry({
          downloadId: id(4),
          mediaId: 1,
          pending: { play: false, position: 185, furthest: null, at: 90, accountId: null },
        }),
      ],
    })
    expect(remove({ state: again, downloadId: id(4) }).owed).toEqual([
      {
        serverId: SERVER_A,
        mediaId: 1,
        pending: { play: true, position: 185, furthest: 190, at: 90, accountId: null },
      },
    ])
  })

  it('owedOf finds an owed item by server and media, or null', () => {
    const owed = remove({ state: owing, downloadId: id(1) })
    expect(
      owedOf({ state: owed, serverId: SERVER_A, mediaId: 1, accountId: null })?.pending ?? null,
    ).toEqual(PLAYED)
    expect(owedOf({ state: owed, serverId: SERVER_B, mediaId: 1, accountId: null })).toBeNull()
  })

  it('clearOwed clears what was sent, and drops the item once nothing is left', () => {
    const owed = remove({ state: owing, downloadId: id(1) })
    const key = { serverId: SERVER_A, mediaId: 1, accountId: null }
    const played = clearOwed({
      state: owed,
      ...key,
      sentPlay: true,
      sentPosition: null,
      sentFurthest: null,
    })
    expect(owedOf({ state: played, ...key })?.pending).toEqual({ ...PLAYED, play: false })
    const furthest = clearOwed({
      state: played,
      ...key,
      sentPlay: false,
      sentPosition: null,
      sentFurthest: 190,
    })
    expect(owedOf({ state: furthest, ...key })?.pending).toEqual({
      ...PLAYED,
      play: false,
      furthest: null,
    })
    expect(
      clearOwed({ state: furthest, ...key, sentPlay: false, sentPosition: 180, sentFurthest: 180 })
        .owed,
    ).toEqual([])
  })

  it('clearOwed keeps a position other than the one sent, and changes nothing for an item not owed', () => {
    const owed = remove({ state: owing, downloadId: id(1) })
    const key = { serverId: SERVER_A, mediaId: 1, accountId: null }
    const next = clearOwed({
      state: owed,
      ...key,
      sentPlay: true,
      sentPosition: 100,
      sentFurthest: 190,
    })
    expect(owedOf({ state: next, ...key })?.pending).toEqual({
      play: false,
      position: 180,
      furthest: null,
      at: 50,
      accountId: null,
    })
    expect(
      clearOwed({
        state: owed,
        serverId: SERVER_B,
        mediaId: 1,
        accountId: null,
        sentPlay: true,
        sentPosition: 180,
        sentFurthest: 190,
      }),
    ).toBe(owed)
  })

  it('dropOwed drops one item, and changes nothing for an item not owed', () => {
    const owed = removeAll(owing)
    expect(dropOwed({ state: owed, serverId: SERVER_A, mediaId: 1, accountId: null }).owed).toEqual(
      [{ serverId: SERVER_B, mediaId: 2, pending: PLAYED }],
    )
    expect(dropOwed({ state: owed, serverId: SERVER_A, mediaId: 2, accountId: null })).toBe(owed)
  })
})

describe('pending', () => {
  it('notePending records what the server has not heard', () => {
    const next = notePending({
      state: stateOf(entry()),
      downloadId: ID,
      play: true,
      position: 42,
      at: 9,
      accountId: null,
    })
    expect(next.entries[0]?.pending ?? null).toEqual({
      play: true,
      position: 42,
      furthest: 42,
      at: 9,
      accountId: null,
    })
  })

  it('notePending keeps the furthest position through a scrub back, and raises it past', () => {
    const watched = notePending({
      state: stateOf(entry()),
      downloadId: ID,
      play: true,
      position: 190,
      at: 1,
      accountId: null,
    })
    const back = notePending({
      state: watched,
      downloadId: ID,
      play: false,
      position: 140,
      at: 2,
      accountId: null,
    })
    expect(back.entries[0]?.pending ?? null).toEqual({
      play: true,
      position: 140,
      furthest: 190,
      at: 2,
      accountId: null,
    })
    const past = notePending({
      state: back,
      downloadId: ID,
      play: false,
      position: 195,
      at: 3,
      accountId: null,
    })
    expect(past.entries[0]?.pending ?? null).toEqual({
      play: true,
      position: 195,
      furthest: 195,
      at: 3,
      accountId: null,
    })
  })

  it('notePending keeps a play the server has not heard when a position report follows', () => {
    const played = notePending({
      state: stateOf(entry()),
      downloadId: ID,
      play: true,
      position: 10,
      at: 1,
      accountId: null,
    })
    const next = notePending({
      state: played,
      downloadId: ID,
      play: false,
      position: 20,
      at: 2,
      accountId: null,
    })
    expect(next.entries[0]?.pending ?? null).toEqual({
      play: true,
      position: 20,
      furthest: 20,
      at: 2,
      accountId: null,
    })
  })

  it('clearPending clears the play, the position and the furthest it sent', () => {
    const state = stateOf(
      entry({ pending: { play: true, position: 42, furthest: 42, at: 9, accountId: null } }),
    )
    const next = clearPending({
      state,
      downloadId: ID,
      sentPlay: true,
      sentPosition: 42,
      sentFurthest: 42,
    })
    expect(next.entries[0]?.pending ?? null).toEqual({
      play: false,
      position: null,
      furthest: null,
      at: 9,
      accountId: null,
    })
  })

  it('clearPending keeps a play it did not send', () => {
    const state = stateOf(
      entry({ pending: { play: true, position: 42, furthest: 42, at: 9, accountId: null } }),
    )
    const next = clearPending({
      state,
      downloadId: ID,
      sentPlay: false,
      sentPosition: 42,
      sentFurthest: 42,
    })
    expect(next.entries[0]?.pending ?? null).toEqual({
      play: true,
      position: null,
      furthest: null,
      at: 9,
      accountId: null,
    })
  })

  it('clearPending keeps a newer position', () => {
    const state = stateOf(
      entry({ pending: { play: true, position: 60, furthest: 60, at: 12, accountId: null } }),
    )
    const next = clearPending({
      state,
      downloadId: ID,
      sentPlay: true,
      sentPosition: 42,
      sentFurthest: 42,
    })
    expect(next.entries[0]?.pending ?? null).toEqual({
      play: false,
      position: 60,
      furthest: 60,
      at: 12,
      accountId: null,
    })
  })

  it('clearPending keeps a furthest raised past the one it sent', () => {
    const state = stateOf(
      entry({ pending: { play: false, position: 70, furthest: 99, at: 12, accountId: null } }),
    )
    const next = clearPending({
      state,
      downloadId: ID,
      sentPlay: false,
      sentPosition: null,
      sentFurthest: 95,
    })
    expect(next).toBe(state)
  })

  it('clearPending of nothing pending returns the same state', () => {
    const state = stateOf(entry())
    expect(
      clearPending({
        state,
        downloadId: ID,
        sentPlay: true,
        sentPosition: null,
        sentFurthest: null,
      }),
    ).toBe(state)
  })
})

describe('forgetServerPosition', () => {
  it("drops the server's resume spot once a position is noted here", () => {
    const next = forgetServerPosition({
      state: stateOf(entry({ serverPosition: 4200 })),
      downloadId: ID,
    })
    expect(next.entries[0]?.serverPosition).toBe(0)
  })

  it('returns the same state when there is none', () => {
    const state = stateOf(entry())
    expect(forgetServerPosition({ state, downloadId: ID })).toBe(state)
  })
})
