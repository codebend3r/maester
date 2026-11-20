import { basename, isAbsolute } from 'node:path'
import { isVideoFile } from '@raven/core'

export type GrantedFile = {
  fileId: string
  path: string
  name: string
  size: number
  mtimeMs: number
}

export type GrantFs = {
  realpath: (path: string) => Promise<string>
  stat: (path: string) => Promise<{ isFile: () => boolean; size: number; mtimeMs: number }>
}

export type Grants = {
  /** Grants a video file an id the page may hold; null for a path that is missing, no file or no video. */
  grant: (path: string) => Promise<Readonly<GrantedFile> | null>
  fileOf: (fileId: string) => Readonly<GrantedFile> | null
}

const ID_DRAWS = 8

const attempt = async <T>(run: () => Promise<T>): Promise<T | null> => {
  try {
    return await run()
  } catch {
    return null
  }
}

type CreateGrantsProps = { fs: GrantFs; newId: () => string }

export const createGrants = ({ fs, newId }: CreateGrantsProps): Grants => {
  const byId = new Map<string, Readonly<GrantedFile>>()
  const idByPath = new Map<string, string>()

  // An id already held by another file would re-point that grant, so draw again.
  const unusedId = (draws: number): string => {
    if (draws === 0) throw new Error('Raven could not draw a unique file id.')
    const id = newId()
    return byId.has(id) ? unusedId(draws - 1) : id
  }

  const grant: Grants['grant'] = async (path) => {
    if (!isAbsolute(path)) return null
    const real = await attempt(() => fs.realpath(path))
    if (real === null) return null
    // The real name counts too: a link called trailer.mp4 must not expose a non-video.
    if (!isVideoFile(basename(path)) || !isVideoFile(basename(real))) return null
    const stats = await attempt(() => fs.stat(real))
    if (stats === null) return null
    if (!stats.isFile()) return null

    const fileId = idByPath.get(real) ?? unusedId(ID_DRAWS)
    const file = Object.freeze({
      fileId,
      path: real,
      name: basename(real),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    } satisfies GrantedFile)
    idByPath.set(real, fileId)
    byId.set(fileId, file)
    return file
  }

  return { grant, fileOf: (fileId) => byId.get(fileId) ?? null }
}
