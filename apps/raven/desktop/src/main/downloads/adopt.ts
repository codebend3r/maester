import {
  type DownloadEntry,
  type DownloadsState,
  keepOneServer,
} from '@/main/downloads/downloadState'
import { entryDirFor, serverDirFor } from '@/main/downloads/space'
import { errorText } from '@/main/log/errorText'
import { loggable } from '@/main/servers/serverCalls'

/** The parts of `node:fs/promises` the move uses; main passes a recursive `mkdir`. */
export type AdoptFs = {
  mkdir: (path: string) => Promise<void>
  rename: (input: { from: string; to: string }) => Promise<void>
  exists: (path: string) => Promise<boolean>
}

/** An adopted server's downloads whose folders move: one per title, none the server already has. */
const movableOf = ({
  state,
  serverId,
  adopted,
}: {
  state: DownloadsState
  serverId: string
  adopted: readonly string[]
}): DownloadEntry[] => {
  const held = new Set(
    state.entries.filter((entry) => entry.serverId === serverId).map(({ mediaId }) => mediaId),
  )
  return state.entries
    .filter((entry) => adopted.includes(entry.serverId))
    .reduce<DownloadEntry[]>(
      (movable, entry) =>
        held.has(entry.mediaId) || movable.some(({ mediaId }) => mediaId === entry.mediaId)
          ? movable
          : [...movable, entry],
      [],
    )
}

/**
 * At launch, before the downloads start: every download filed under the one server. An adopted
 * server's folders move under the server's id first, one at a time; a folder that is already
 * there (a launch that ended before it saved) or was never made counts as moved, and one that
 * cannot move stays where it is, playable, what it owed owed by the server. Never rejects.
 */
export const settleDownloads = async ({
  state,
  serverId,
  adopted,
  userData,
  fs,
  warn,
}: {
  state: DownloadsState
  serverId: string
  adopted: readonly string[]
  userData: string
  fs: AdoptFs
  warn: (message: string) => void
}): Promise<DownloadsState> => {
  const movable = movableOf({ state, serverId, adopted })
  if (movable.length > 0) {
    await fs.mkdir(serverDirFor({ userData, serverId })).catch(() => undefined)
  }
  const isThere = (path: string): Promise<boolean> => fs.exists(path).catch(() => false)
  const moveOne = async (entry: DownloadEntry): Promise<boolean> => {
    const from = entryDirFor({ userData, ...entry })
    const to = entryDirFor({ userData, serverId, mediaId: entry.mediaId })
    try {
      await fs.rename({ from, to })
      return true
    } catch (error) {
      // A queued download may have no folder yet: there is nothing to move.
      if ((await isThere(to)) || !(await isThere(from))) return true
      warn(`Raven could not move a download to its server: ${loggable(errorText(error))}`)
      return false
    }
  }
  const moved = await movable.reduce<Promise<ReadonlySet<string>>>(async (soFar, entry) => {
    const done = await soFar
    return (await moveOne(entry)) ? new Set([...done, entry.downloadId]) : done
  }, Promise.resolve(new Set()))
  return keepOneServer({ state, serverId, adopted, moved })
}
