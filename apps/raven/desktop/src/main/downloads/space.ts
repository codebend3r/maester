import { join } from 'node:path'
import {
  isAudioContainer,
  isContainerName,
  isMediaId,
  isOpaqueId,
  isSidecarTrackId,
} from '@raven/core'
import {
  isPictureExtension,
  isPictureFolder,
  type SavedPicture,
} from '@/main/downloads/downloadState'

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

type ReadSpaceProps = { fs: SpaceFs; dir: string }

export const readSpace = async ({ fs, dir }: ReadSpaceProps): Promise<Space> => {
  await fs.mkdir(dir)
  const { bavail, bsize, blocks } = await fs.statfs(dir)
  return { free: bavail * bsize, total: blocks * bsize }
}

type FitsProps = { bytes: number; free: number }

export const fits = ({ bytes, free }: FitsProps): boolean => bytes + SPACE_RESERVE_BYTES <= free

type EntryParts = { userData: string; serverId: string; mediaId: number }

type DownloadsDirForProps = { userData: string }

export const downloadsDirFor = ({ userData }: DownloadsDirForProps): string =>
  join(userData, DOWNLOADS_DIR)

type ServerDirForProps = {
  userData: string
  serverId: string
}

/** One server's downloads, the folder removing that server removes. */
export const serverDirFor = ({ userData, serverId }: ServerDirForProps): string => {
  if (!isOpaqueId(serverId)) throw new RangeError('A download needs a server id')
  return join(downloadsDirFor({ userData }), serverId)
}

export const entryDirFor = ({ userData, serverId, mediaId }: EntryParts): string => {
  if (!isMediaId(mediaId)) throw new RangeError('A download needs a media id')
  return join(serverDirFor({ userData, serverId }), String(mediaId))
}

type MediaPathForProps = EntryParts & { container: string }

/**
 * The downloaded file: `media.<container>` for a track, `video.<container>` for anything else,
 * the name every video downloaded before music kept, so none moves.
 */
export const mediaPathFor = ({ container, ...entry }: MediaPathForProps): string => {
  if (!isContainerName(container)) throw new RangeError('A download needs a container name')
  const name = isAudioContainer(container) ? 'media' : 'video'
  return join(entryDirFor(entry), `${name}.${container}`)
}

/** Where the file lands while it downloads, before it is renamed to its `mediaPathFor`. */
export const partPathFor = (parts: MediaPathForProps): string => `${mediaPathFor(parts)}.part`

export const subtitlesDirFor = (parts: EntryParts): string => join(entryDirFor(parts), 'subtitles')

export const sidecarPathFor = ({ trackId, ...entry }: EntryParts & { trackId: string }): string => {
  if (!isSidecarTrackId(trackId)) throw new RangeError('A subtitle needs an external track id')
  return join(subtitlesDirFor(entry), `${trackId}.vtt`)
}

/** The folder under a server's downloads that holds every title's and album's saved pictures. */
const PICTURES_DIR = 'pictures'

export const picturesDirFor = (parts: ServerDirForProps): string =>
  join(serverDirFor(parts), PICTURES_DIR)

type PictureFolderForProps = ServerDirForProps & { folder: string }

/** One title's or album's pictures, the folder that goes with its last download. */
export const pictureFolderFor = ({ folder, ...server }: PictureFolderForProps): string => {
  if (!isPictureFolder(folder)) throw new RangeError('A picture needs an item or album folder')
  return join(picturesDirFor(server), folder)
}

type PicturePathForProps = ServerDirForProps & { picture: SavedPicture }

export const picturePathFor = ({ picture, ...server }: PicturePathForProps): string => {
  const { id, folder, extension } = picture
  if (!isOpaqueId(id)) throw new RangeError('A picture needs an id')
  if (!isPictureExtension(extension)) throw new RangeError('A picture needs a known extension')
  return join(pictureFolderFor({ ...server, folder }), `${id}.${extension}`)
}
