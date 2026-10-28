import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { project } from '@/build/context'
import { isPrebuilt, type Prebuilt } from '@/windows'

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
  addon: 'raven_mpv.node',
} as const
