import { join } from 'node:path'
import { isMediaId } from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import { removeServer, type DownloadEntry } from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { downloadsDirFor } from '@/main/downloads/space'
import { errorText } from '@/main/log/errorText'
import { loggable } from '@/main/servers/serverCalls'
import { isMissingFile } from '@/main/stateStore'
import { isOpaqueId } from '@/shared/protocol'

/** The parts of `node:fs/promises` the sweep uses; main passes a forced, recursive `rm`. */
export type SweepFs = {
  readdir: (path: string) => Promise<string[]>
  rm: (path: string) => Promise<void>
}

export type SweepDeps = {
  store: DownloadsStore
  fs: SweepFs
  /** Every server raven player keeps, as the config holds them now. */
  servers: () => readonly ServerEntry[]
  userData: string
  warn: (message: string) => void
  /** The downloads the sweep dropped, so what else names them can go too. */
  onRemoved: (entries: readonly DownloadEntry[]) => void
}

/** A folder name as a media id writes it, so `012` is never taken for `12`'s folder. */
const isMediaFolder = (name: string): boolean =>
  /^\d+$/u.test(name) && isMediaId(Number(name)) && String(Number(name)) === name

/** Removes a folder; one that stays is swept at the next launch, so a failure is only logged. */
export const removeFolder = async ({
  fs,
  warn,
  path,
  what,
}: {
  fs: Pick<SweepFs, 'rm'>
  warn: (message: string) => void
  path: string
  what: string
}): Promise<void> => {
  await fs.rm(path).catch((error: unknown) => {
    warn(`raven player could not remove ${what}: ${loggable(errorText(error))}`)
  })
}

const sweepFolders = async ({
  store,
  fs,
  servers,
  userData,
  warn,
  onRemoved,
  wasSetAside,
}: SweepDeps & { wasSetAside: boolean }): Promise<void> => {
  /** The names in a folder; none when it does not exist, and none, with a warning, when it cannot be read. */
  const namesIn = (path: string): Promise<string[]> =>
    fs.readdir(path).catch((error: unknown) => {
      if (!isMissingFile(error)) {
        warn(`raven player could not read its downloads: ${loggable(errorText(error))}`)
      }
      return []
    })
  const removing = ({ path, what }: { path: string; what: string }) =>
    removeFolder({ fs, warn, path, what })

  const kept = servers().map(({ id }) => id)
  // An unreadable config loads empty and is set aside; its servers' downloads must outlive that.
  const canDropServers = kept.length > 0
  const isKept = (serverId: string): boolean => kept.includes(serverId)
  const { entries, owed } = store.read()
  const dropped = canDropServers ? entries.filter((entry) => !isKept(entry.serverId)) : []
  // A server's removal that did not reach `downloads.json` ends here, as Remove server would:
  // its downloads owe it nothing and what it was owed goes, since no call can reach it now.
  const held = new Set([...entries, ...owed].map(({ serverId }) => serverId))
  const gone = canDropServers ? [...held].filter((serverId) => !isKept(serverId)) : []
  store.update((state) => gone.reduce((next, serverId) => removeServer(next, { serverId }), state))
  if (dropped.length > 0) {
    onRemoved(dropped)
    warn(`raven player dropped ${dropped.length} downloads of servers it no longer keeps`)
  }
  const root = downloadsDirFor({ userData })
  const listed = (await namesIn(root)).filter(isOpaqueId)
  const goneServers = canDropServers ? listed.filter((serverId) => !isKept(serverId)) : []
  // Read as each folder is listed, so a file queued meanwhile keeps its folder.
  const isNamed = ({ serverId, name }: { serverId: string; name: string }): boolean =>
    store
      .read()
      .entries.some((entry) => entry.serverId === serverId && String(entry.mediaId) === name)
  if (wasSetAside) {
    warn(
      'raven player kept every download folder of its servers: its list of downloads was set aside',
    )
  }
  // A set-aside list names nothing, so every folder would look unnamed; they wait for a later launch.
  const unnamed = (
    await Promise.all(
      listed
        .filter((serverId) => !wasSetAside && isKept(serverId))
        .map(async (serverId) =>
          (await namesIn(join(root, serverId)))
            .filter((name) => isMediaFolder(name) && !isNamed({ serverId, name }))
            .map((name) => join(root, serverId, name)),
        ),
    )
  ).flat()
  await Promise.all([
    ...goneServers.map((serverId) =>
      removing({ path: join(root, serverId), what: "a removed server's downloads" }),
    ),
    ...unnamed.map((path) => removing({ path, what: 'a download folder no download names' })),
  ])
  if (goneServers.length > 0) {
    warn(`raven player removed the downloads of ${goneServers.length} servers it no longer keeps`)
  }
  if (unnamed.length > 0) {
    warn(`raven player removed ${unnamed.length} download folders no download names`)
  }
}

/**
 * At launch: drops the downloads of servers no longer kept and removes their folders, and the
 * media folders no download names, but none of those when `downloads.json` was set aside, since
 * an empty list names nothing. Never rejects.
 */
export const sweepDownloads = (input: SweepDeps & { wasSetAside: boolean }): Promise<void> =>
  sweepFolders(input).catch((error: unknown) => {
    input.warn(`raven player could not sweep its downloads: ${loggable(errorText(error))}`)
  })
