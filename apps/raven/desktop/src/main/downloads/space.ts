import { join } from 'node:path'
import { isContainerName, isMediaId, isOpaqueId, isSidecarTrackId } from '@raven/core'

/** What a download leaves free on the disk, so the system and Raven keep room to work. */
export const SPACE_RESERVE_BYTES = 2 * 1024 ** 3

/** The folder under userData that holds every server's downloads. */
export const DOWNLOADS_DIR = 'downloads'

/** The parts of `node:fs/promises` the free-space read uses; main passes a recursive `mkdir`. */
export type SpaceFs = {
  mkdir: (path: string) => Promise<void>
  statfs: (path: string) => Promise<{ bavail: number; bsize: number; blocks: number }>
}

export type Space = { free: number; total: number }

export const readSpace = async ({ fs, dir }: { fs: SpaceFs; dir: string }): Promise<Space> => {
  await fs.mkdir(dir)
  const { bavail, bsize, blocks } = await fs.statfs(dir)
  return { free: bavail * bsize, total: blocks * bsize }
}

export const fits = ({ bytes, free }: { bytes: number; free: number }): boolean =>
  bytes + SPACE_RESERVE_BYTES <= free

type EntryParts = { userData: string; serverId: string; mediaId: number }

export const downloadsDirFor = ({ userData }: { userData: string }): string =>
  join(userData, DOWNLOADS_DIR)

/** One server's downloads, the folder removing that server removes. */
export const serverDirFor = ({
  userData,
  serverId,
}: {
  userData: string
  serverId: string
}): string => {
  if (!isOpaqueId(serverId)) throw new RangeError('A download needs a server id')
  return join(downloadsDirFor({ userData }), serverId)
}

export const entryDirFor = ({ userData, serverId, mediaId }: EntryParts): string => {
  if (!isMediaId(mediaId)) throw new RangeError('A download needs a media id')
  return join(serverDirFor({ userData, serverId }), String(mediaId))
}

export const videoPathFor = ({
  container,
  ...entry
}: EntryParts & { container: string }): string => {
  if (!isContainerName(container)) throw new RangeError('A download needs a container name')
  return join(entryDirFor(entry), `video.${container}`)
}

/** Where the video lands while it downloads, before it is renamed to `video.<container>`. */
export const partPathFor = (parts: EntryParts & { container: string }): string =>
  `${videoPathFor(parts)}.part`

export const subtitlesDirFor = (parts: EntryParts): string => join(entryDirFor(parts), 'subtitles')

export const sidecarPathFor = ({ trackId, ...entry }: EntryParts & { trackId: string }): string => {
  if (!isSidecarTrackId(trackId)) throw new RangeError('A subtitle needs an external track id')
  return join(subtitlesDirFor(entry), `${trackId}.vtt`)
}
