/** The folder under the app's documents every download lives in, one folder per server inside it. */
export const DOWNLOADS_FOLDER = 'downloads'

/** What a file is called while its bytes come in, beside the place it moves to once whole. */
export const PART_SUFFIX = '.part'

const PATH_SEPARATOR = '/'

type FolderOfProps = { serverId: string; mediaId: number }

/** A download's folder: `downloads/<serverId>/<mediaId>`. */
export const folderOf = ({ serverId, mediaId }: FolderOfProps): string =>
  [DOWNLOADS_FOLDER, serverId, String(mediaId)].join(PATH_SEPARATOR)

type InFolderProps = { folder: string; file: string }

/** A file's path in `folder`. */
export const inFolder = ({ folder, file }: InFolderProps): string =>
  [folder, file].join(PATH_SEPARATOR)

/** The folder a file's path is in. */
export const folderOfPath = (path: string): string =>
  path.split(PATH_SEPARATOR).slice(0, -1).join(PATH_SEPARATOR)
