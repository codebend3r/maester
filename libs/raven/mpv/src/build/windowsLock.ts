import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isString, object, type Infer } from '@raven/core'
import { project } from '@/build/context'

const isPrebuiltShape = object({
  name: isString,
  repository: isString,
  release: isString,
  mpvCommit: isString,
  url: isString,
  sha256: isString,
  libmpvSha256: isString,
  license: isString,
})

export type Prebuilt = Infer<typeof isPrebuiltShape>

const SHA256 = /^[a-f0-9]{64}$/

/**
 * The Windows libmpv is a prebuilt from mpv-winbuild-cmake, pinned to one release
 * archive by digest, and the DLL inside it by its own digest. The URL is derived from
 * the repository, the release and mpv's commit, so the lock cannot point elsewhere.
 */
export const isPrebuilt = (value: unknown): value is Prebuilt =>
  isPrebuiltShape(value) &&
  /^[a-zA-Z0-9_-]+$/.test(value.name) &&
  /^\d{8}$/.test(value.release) &&
  /^[a-f0-9]{10}$/.test(value.mpvCommit) &&
  SHA256.test(value.sha256) &&
  SHA256.test(value.libmpvSha256) &&
  /^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(value.repository) &&
  value.url ===
    `${value.repository}/releases/download/${value.release}/mpv-dev-x86_64-${value.release}-git-${value.mpvCommit}.7z`

export const prebuilt = async (): Promise<Prebuilt> => {
  const value: unknown = JSON.parse(
    await readFile(resolve(project, 'native/windows.lock.json'), 'utf8'),
  )
  if (!isPrebuilt(value)) throw new Error('Invalid Windows libmpv lock')
  return value
}

/** What the Windows resources hold, relative to `resources/win32-x64`. */
export const WINDOWS_FILES = {
  libmpv: 'libmpv-2.dll',
  headers: 'include/mpv',
} as const
