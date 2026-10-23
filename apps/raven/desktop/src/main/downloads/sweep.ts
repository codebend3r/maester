import { join } from 'node:path'
import { isMediaId, isOpaqueId } from '@raven/core'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { downloadsDirFor } from '@/main/downloads/space'
import { errorText } from '@/main/log/errorText'
import { loggable } from '@/main/servers/serverCalls'
import { isMissingFile } from '@/main/stateStore'

/** The parts of `node:fs/promises` the sweep uses; main passes a forced, recursive `rm`. */
export type SweepFs = {
  readdir: (path: string) => Promise<string[]>
  rm: (path: string) => Promise<void>
}

export type SweepDeps = {
  store: DownloadsStore
  fs: SweepFs
  userData: string
  warn: (message: string) => void
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
    warn(`Raven could not remove ${what}: ${loggable(errorText(error))}`)
  })
}

const sweepFolders = async ({
  store,
  fs,
  userData,
  warn,
  wasSetAside,
}: SweepDeps & { wasSetAside: boolean }): Promise<void> => {
  // A set-aside list names nothing, so every folder would look unnamed; they wait for a later launch.
  if (wasSetAside) {
    warn('Raven kept every download folder: its list of downloads was set aside')
    return
  }
  /** The names in a folder; none when it does not exist, and none, with a warning, when it cannot be read. */
  const namesIn = (path: string): Promise<string[]> =>
    fs.readdir(path).catch((error: unknown) => {
      if (!isMissingFile(error)) {
        warn(`Raven could not read its downloads: ${loggable(errorText(error))}`)
      }
      return []
    })
  const removing = ({ path, what }: { path: string; what: string }) =>
    removeFolder({ fs, warn, path, what })

  const root = downloadsDirFor({ userData })
  const listed = (await namesIn(root)).filter(isOpaqueId)
  // Read as each folder is listed, so a file queued meanwhile keeps its folder.
  const isServerNamed = (serverId: string): boolean =>
    store.read().entries.some((entry) => entry.serverId === serverId)
  const isNamed = ({ serverId, name }: { serverId: string; name: string }): boolean =>
    store
      .read()
      .entries.some((entry) => entry.serverId === serverId && String(entry.mediaId) === name)
  const unnamedServers = listed.filter((serverId) => !isServerNamed(serverId))
  const unnamed = (
    await Promise.all(
      listed
        .filter(isServerNamed)
        .map(async (serverId) =>
          (await namesIn(join(root, serverId)))
            .filter((name) => isMediaFolder(name) && !isNamed({ serverId, name }))
            .map((name) => join(root, serverId, name)),
        ),
    )
  ).flat()
  await Promise.all([
    ...unnamedServers.map((serverId) =>
      removing({ path: join(root, serverId), what: 'a server folder no download names' }),
    ),
    ...unnamed.map((path) => removing({ path, what: 'a download folder no download names' })),
  ])
  if (unnamedServers.length > 0) {
    warn(`Raven removed ${unnamedServers.length} server folders no download names`)
  }
  if (unnamed.length > 0) {
    warn(`Raven removed ${unnamed.length} download folders no download names`)
  }
}

/**
 * At launch: removes the folders no download names, a server's whole or one title's, but none of
 * them when `downloads.json` was set aside, since an empty list names nothing. Never rejects.
 */
export const sweepDownloads = (input: SweepDeps & { wasSetAside: boolean }): Promise<void> =>
  sweepFolders(input).catch((error: unknown) => {
    input.warn(`Raven could not sweep its downloads: ${loggable(errorText(error))}`)
  })
