import { DOWNLOAD_STATUS_KINDS } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import {
  EMPTY_DOWNLOADS,
  adoptServers,
  type DownloadsState,
  type Pending,
} from '@/main/downloads/downloadState'
import { entry, id, SERVER_A, SERVER_B, stateOf } from '@/main/test/downloadEntries'

describe('adoptServers', () => {
  // An older Raven's server that was not the home one, and one of the account's servers.
  const SERVER_C = id(30)
  const SERVER_D = id(40)
  const PLAYED: Pending = { play: true, position: 180, furthest: 190, at: 50, accountId: 'ada' }
  const LATER: Pending = { play: false, position: 200, furthest: 200, at: 60, accountId: 'ada' }
  const ready = { kind: DOWNLOAD_STATUS_KINDS.ready } as const
  type KeepProps = { state: DownloadsState; moved?: readonly string[] }

  const keep = ({ state, moved = [] }: KeepProps) =>
    adoptServers({
      state,
      serverId: SERVER_A,
      adopted: [SERVER_B],
      dropped: [SERVER_C],
      moved: new Set(moved),
    })

  it("keeps the server's own downloads and what it is owed as they are", () => {
    const state = {
      ...stateOf(entry({ downloadId: id(1), mediaId: 1, pending: PLAYED })),
      owed: [{ serverId: SERVER_A, mediaId: 2, pending: PLAYED }],
    }
    expect(keep({ state })).toBe(state)
  })

  it("keeps an account server's downloads, unfinished, pending and owed alike", () => {
    const state = {
      ...stateOf(
        entry({ downloadId: id(1), mediaId: 1, serverId: SERVER_D, pending: PLAYED }),
        entry({ downloadId: id(2), mediaId: 2, serverId: SERVER_D, status: ready }),
      ),
      owed: [{ serverId: SERVER_D, mediaId: 3, pending: PLAYED }],
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

  it("keeps a dropped server's ready downloads to play, owing it nothing, and drops the rest", () => {
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

  it("moves what an adopted server was owed to the server, drops a dropped one's and keeps an account server's", () => {
    const state = {
      ...EMPTY_DOWNLOADS,
      owed: [
        { serverId: SERVER_A, mediaId: 1, pending: PLAYED },
        { serverId: SERVER_B, mediaId: 1, pending: LATER },
        { serverId: SERVER_B, mediaId: 2, pending: PLAYED },
        { serverId: SERVER_C, mediaId: 3, pending: PLAYED },
        { serverId: SERVER_D, mediaId: 4, pending: PLAYED },
      ],
    }
    expect(keep({ state }).owed).toEqual([
      {
        serverId: SERVER_A,
        mediaId: 1,
        pending: { play: true, position: 200, furthest: 200, at: 60, accountId: 'ada' },
      },
      { serverId: SERVER_A, mediaId: 2, pending: PLAYED },
      { serverId: SERVER_D, mediaId: 4, pending: PLAYED },
    ])
  })

  it('settles once: a second pass changes nothing', () => {
    const state = stateOf(
      entry({ downloadId: id(1), mediaId: 1, serverId: SERVER_C, status: ready, pending: PLAYED }),
      entry({ downloadId: id(2), mediaId: 2, serverId: SERVER_B }),
      entry({ downloadId: id(3), mediaId: 3, serverId: SERVER_D }),
    )
    const settled = keep({ state, moved: [id(2)] })
    expect(keep({ state: settled })).toBe(settled)
  })
})
