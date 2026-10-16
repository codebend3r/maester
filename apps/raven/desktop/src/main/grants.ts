import { basename, isAbsolute } from 'node:path'
import { isVideoFile } from '@raven/core'

export type GrantedFile = {
  fileId: string
  path: string
  name: string
  size: number
  mtimeMs: number
}

export type GrantRefusal = 'missing' | 'not-a-file' | 'not-a-video'

export type GrantResult =
  | { ok: true; file: Readonly<GrantedFile> }
  | { ok: false; reason: GrantRefusal }

export type GrantFs = {
  realpath: (path: string) => Promise<string>
  stat: (path: string) => Promise<{ isFile: () => boolean; size: number; mtimeMs: number }>
}

export type Grants = {
  grant: (path: string) => Promise<GrantResult>
  fileOf: (fileId: string) => Readonly<GrantedFile> | null
}

export const ID_DRAWS = 8

const refuse = (reason: GrantRefusal): GrantResult => ({ ok: false, reason })

const attempt = async <T>(run: () => Promise<T>): Promise<T | null> => {
  try {
    return await run()
  } catch {
    return null
  }
}

export const createGrants = ({ fs, newId }: { fs: GrantFs; newId: () => string }): Grants => {
  const byId = new Map<string, Readonly<GrantedFile>>()
  const idByPath = new Map<string, string>()

  // An id already held by another file would re-point that grant, so draw again.
  const unusedId = (draws: number): string => {
    if (draws === 0) throw new Error('raven player could not draw a unique file id.')
    const id = newId()
    return byId.has(id) ? unusedId(draws - 1) : id
  }

  const grant = async (path: string): Promise<GrantResult> => {
    if (!isAbsolute(path)) return refuse('missing')
    const real = await attempt(() => fs.realpath(path))
    if (real === null) return refuse('missing')
    // The real name counts too: a link called trailer.mp4 must not expose a non-video.
    if (!isVideoFile(basename(path)) || !isVideoFile(basename(real))) return refuse('not-a-video')
    const stats = await attempt(() => fs.stat(real))
    if (stats === null) return refuse('missing')
    if (!stats.isFile()) return refuse('not-a-file')

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
    return { ok: true, file }
  }

  return { grant, fileOf: (fileId) => byId.get(fileId) ?? null }
}
