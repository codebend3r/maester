import { DOWNLOAD_STATUS_KINDS } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import {
  EMPTY_DOWNLOADS,
  keepOneServer,
  type DownloadsState,
  type Pending,
} from '@/main/downloads/downloadState'
import { entry, id, SERVER_A, SERVER_B, stateOf } from '@/main/test/downloadEntries'

describe('keepOneServer', () => {
  const SERVER_C = id(30)
  const PLAYED: Pending = { play: true, position: 180, furthest: 190, at: 50, accountId: 'ada' }
  const LATER: Pending = { play: false, position: 200, furthest: 200, at: 60, accountId: 'ada' }
  const ready = { kind: DOWNLOAD_STATUS_KINDS.ready } as const
  const keep = ({ state, moved = [] }: { state: DownloadsState; moved?: readonly string[] }) =>
    keepOneServer({ state, serverId: SERVER_A, adopted: [SERVER_B], moved: new Set(moved) })

  it("keeps the server's own downloads and what it is owed as they are", () => {
    const state = {
      ...stateOf(entry({ downloadId: id(1), mediaId: 1, pending: PLAYED })),
      owed: [{ serverId: SERVER_A, mediaId: 2, pending: PLAYED }],
    }
    expect(keep({ state })).toBe(state)
  })

  it("files an adopted server's moved downloads under the server, pending and all", () => {
    const state = stateOf(
      entry({ downloadId: id(2), mediaId: 2, serverId: SERVER_B, pending: PLAYED }),
    )
    expect(keep({ state, moved: [id(2)] }).entries).toEqual([
      entry({ downloadId: id(2), mediaId: 2, serverId: SERVER_A, pending: PLAYED }),
    ])
  })

  it("keeps another server's ready downloads to play, owing it nothing, and drops the rest", () => {
    const state = stateOf(
      entry({ downloadId: id(1), mediaId: 1, serverId: SERVER_C, status: ready, pending: PLAYED }),
      entry({ downloadId: id(2), mediaId: 2, serverId: SERVER_C }),
      entry({ downloadId: id(3), mediaId: 3, serverId: SERVER_B, status: ready }),
    )
    expect(keep({ state }).entries).toEqual([
      entry({ downloadId: id(1), mediaId: 1, serverId: SERVER_C, status: ready }),
      entry({ downloadId: id(3), mediaId: 3, serverId: SERVER_B, status: ready }),
    ])
  })

  it("moves what an adopted server was owed to the server, folded into what it already was, and drops another's", () => {
    const state = {
      ...EMPTY_DOWNLOADS,
      owed: [
        { serverId: SERVER_A, mediaId: 1, pending: PLAYED },
        { serverId: SERVER_B, mediaId: 1, pending: LATER },
        { serverId: SERVER_B, mediaId: 2, pending: PLAYED },
        { serverId: SERVER_C, mediaId: 3, pending: PLAYED },
      ],
    }
    expect(keep({ state }).owed).toEqual([
      {
        serverId: SERVER_A,
        mediaId: 1,
        pending: { play: true, position: 200, furthest: 200, at: 60, accountId: 'ada' },
      },
      { serverId: SERVER_A, mediaId: 2, pending: PLAYED },
    ])
  })

  it('settles once: a second pass changes nothing', () => {
    const state = stateOf(
      entry({ downloadId: id(1), mediaId: 1, serverId: SERVER_C, status: ready, pending: PLAYED }),
      entry({ downloadId: id(2), mediaId: 2, serverId: SERVER_B }),
    )
    const settled = keep({ state, moved: [id(2)] })
    expect(keep({ state: settled })).toBe(settled)
  })
})
