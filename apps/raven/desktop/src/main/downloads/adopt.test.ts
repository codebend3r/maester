import { DOWNLOAD_STATUS_KINDS } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { settleDownloads, type AdoptFs } from '@/main/downloads/adopt'
import { EMPTY_DOWNLOADS, NO_PENDING, type DownloadsState } from '@/main/downloads/downloadState'
import { entryDirFor } from '@/main/downloads/space'
import { entry, id, SERVER_A, SERVER_B, stateOf } from '@/main/test/downloadEntries'

const USER_DATA = '/data'
const ready = { kind: DOWNLOAD_STATUS_KINDS.ready } as const

type DirOfProps = { serverId: string; mediaId: number }

const dirOf = ({ serverId, mediaId }: DirOfProps): string =>
  entryDirFor({ userData: USER_DATA, serverId, mediaId })

type FakeFsProps = {
  folders: readonly string[]
  isBroken?: boolean
}

/** Folders by path; a rename moves one, and fails for a source that is not there. */
const fakeFs = ({ folders, isBroken = false }: FakeFsProps) => {
  const present = new Set(folders)
  const made: string[] = []
  const fs: AdoptFs = {
    mkdir: async (path) => {
      made.push(path)
    },
    rename: async ({ from, to }) => {
      if (isBroken || !present.has(from)) throw new Error(`ENOENT: ${from}`)
      present.delete(from)
      present.add(to)
    },
    exists: async (path) => present.has(path),
  }
  return { fs, present, made }
}

type SettleProps = {
  state: DownloadsState
  fs: AdoptFs
  adopted?: readonly string[]
}

const settle = ({ state, fs, adopted = [SERVER_B] }: SettleProps) => {
  const warnings: string[] = []
  return {
    warnings,
    settling: settleDownloads({
      state,
      serverId: SERVER_A,
      adopted,
      userData: USER_DATA,
      fs,
      warn: (message) => warnings.push(message),
    }),
  }
}

describe('settleDownloads', () => {
  it("moves an adopted server's folders under the server and files its downloads there", async () => {
    const adopted = entry({ downloadId: id(2), mediaId: 2, serverId: SERVER_B, status: ready })
    const { fs, present, made } = fakeFs({ folders: [dirOf(adopted)] })
    const { settling, warnings } = settle({ state: stateOf(adopted), fs })
    expect((await settling).entries).toEqual([{ ...adopted, serverId: SERVER_A }])
    expect([...present]).toEqual([dirOf({ serverId: SERVER_A, mediaId: 2 })])
    expect(made).toEqual([`${USER_DATA}/downloads/${SERVER_A}`])
    expect(warnings).toEqual([])
  })

  it('counts a folder already under the server as moved, as a launch that ended before it saved left it', async () => {
    const adopted = entry({ downloadId: id(2), mediaId: 2, serverId: SERVER_B, status: ready })
    const { fs } = fakeFs({ folders: [dirOf({ serverId: SERVER_A, mediaId: 2 })] })
    const { settling } = settle({ state: stateOf(adopted), fs })
    expect((await settling).entries).toEqual([{ ...adopted, serverId: SERVER_A }])
  })

  it('leaves a folder that cannot move where it is, its ready download playable and its play owed to the server', async () => {
    const adopted = entry({
      downloadId: id(2),
      mediaId: 2,
      serverId: SERVER_B,
      status: ready,
      pending: { play: true, position: 5, furthest: 5, at: 1, accountId: 'ada' },
    })
    const { fs } = fakeFs({ folders: [dirOf(adopted)], isBroken: true })
    const { settling, warnings } = settle({ state: stateOf(adopted), fs })
    const settled = await settling
    expect(settled.entries).toEqual([
      entry({ downloadId: id(2), mediaId: 2, serverId: SERVER_B, status: ready }),
    ])
    expect(settled.owed).toEqual([
      {
        serverId: SERVER_A,
        mediaId: 2,
        pending: { play: true, position: 5, furthest: 5, at: 1, accountId: 'ada' },
      },
    ])
    expect(warnings).toEqual([
      `Raven could not move a download to its server: ENOENT: ${dirOf(adopted)}`,
    ])
  })

  it('moves no title the server already has, nor the same title twice', async () => {
    const own = entry({ downloadId: id(1), mediaId: 1, status: ready })
    const twin = entry({ downloadId: id(2), mediaId: 1, serverId: SERVER_B, status: ready })
    const first = entry({ downloadId: id(3), mediaId: 3, serverId: SERVER_B, status: ready })
    const second = entry({ downloadId: id(4), mediaId: 3, serverId: SERVER_B, status: ready })
    const { fs, present } = fakeFs({ folders: [dirOf(own), dirOf(twin), dirOf(first)] })
    const { settling } = settle({ state: stateOf(own, twin, first, second), fs })
    expect(
      (await settling).entries.map(({ downloadId, serverId }) => [downloadId, serverId]),
    ).toEqual([
      [id(1), SERVER_A],
      [id(2), SERVER_B],
      [id(3), SERVER_A],
      [id(4), SERVER_B],
    ])
    expect(present.has(dirOf(twin))).toBe(true)
  })

  it("owes the server a twin's play, merged with what the server's own copy owes", async () => {
    const own = entry({
      downloadId: id(1),
      mediaId: 1,
      status: ready,
      pending: { play: false, position: 30, furthest: 30, at: 5, accountId: 'ada' },
    })
    const twin = entry({
      downloadId: id(2),
      mediaId: 1,
      serverId: SERVER_B,
      status: ready,
      pending: { play: true, position: 10, furthest: 40, at: 2, accountId: 'ada' },
    })
    const { fs } = fakeFs({ folders: [dirOf(own), dirOf(twin)] })
    const settled = await settle({
      state: {
        ...stateOf(own, twin),
        owed: [
          {
            serverId: SERVER_B,
            mediaId: 1,
            pending: { play: false, position: 20, furthest: 20, at: 1, accountId: 'ada' },
          },
        ],
      },
      fs,
    }).settling
    expect(
      settled.entries.map(({ downloadId, serverId, pending }) => [downloadId, serverId, pending]),
    ).toEqual([
      [id(1), SERVER_A, own.pending],
      [id(2), SERVER_B, NO_PENDING],
    ])
    expect(settled.owed).toEqual([
      {
        serverId: SERVER_A,
        mediaId: 1,
        pending: { play: true, position: 10, furthest: 40, at: 2, accountId: 'ada' },
      },
    ])
  })

  it('files a queued download that has no folder yet under the server, as nothing is left to move', async () => {
    const queued = entry({ downloadId: id(2), mediaId: 2, serverId: SERVER_B })
    const { fs, present } = fakeFs({ folders: [] })
    const { settling, warnings } = settle({ state: stateOf(queued), fs })
    const settled = await settling
    expect(settled.entries).toEqual([{ ...queued, serverId: SERVER_A }])
    expect(settled.owed).toEqual([])
    expect([...present]).toEqual([])
    expect(warnings).toEqual([])
  })

  it('touches no folder when nothing is adopted, and hands back the same state', async () => {
    const state = stateOf(entry({ downloadId: id(1), mediaId: 1 }))
    const { fs, made } = fakeFs({ folders: [] })
    const { settling } = settle({ state, fs, adopted: [] })
    expect(await settling).toBe(state)
    expect(made).toEqual([])
    expect(await settle({ state: EMPTY_DOWNLOADS, fs, adopted: [] }).settling).toBe(EMPTY_DOWNLOADS)
  })
})
