import type { Dirent } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import { join, sep } from 'node:path'

/**
 * Ad hoc signing from the inside out. `codesign --deep` signs nested code in an order of its
 * own and skips Mach-O files outside the places it treats as code, such as the addon and
 * libmpv under Contents/Resources, so every file and bundle is signed one by one, deepest
 * first. forge.config.ts imports this file through jiti, which does not read tsconfig
 * `paths`, so it imports nothing from the project.
 */

export const MACH_O_MAGICS = [
  0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
] as const

export const isMachO = (header: Uint8Array): boolean => {
  if (header.length < 4) return false
  const magic = new DataView(header.buffer, header.byteOffset, 4).getUint32(0, false)
  return MACH_O_MAGICS.some((known) => known === magic)
}

export type Signable = { path: string; kind: 'machO' | 'bundle' }

const BUNDLE_SUFFIXES = ['.app', '.framework'] as const

const depthOf = (path: string): number => path.split(sep).length - 1

const byPath = (a: string, b: string): number => {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** The paths to sign, deepest first and ties by path, so nothing is signed before what it holds; the app comes last. */
export const signingOrder = ({
  app,
  entries,
}: {
  app: string
  entries: readonly Signable[]
}): string[] => [
  ...entries
    .map(({ path }) => path)
    .filter((path) => path.startsWith(`${app}${sep}`))
    .toSorted((a, b) => depthOf(b) - depthOf(a) || byPath(a, b)),
  app,
]

const readHeader = async ({ path }: { path: string }): Promise<Uint8Array> => {
  const file = await open(path, 'r')
  try {
    const header = new Uint8Array(4)
    const { bytesRead } = await file.read(header, 0, 4, 0)
    return header.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

const pathOf = (entry: Dirent): string => join(entry.parentPath, entry.name)

const signableOf = async ({
  app,
  entry,
}: {
  app: string
  entry: Dirent
}): Promise<Signable | null> => {
  const path = pathOf(entry)
  if (entry.isDirectory()) {
    const isBundle = BUNDLE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))
    return isBundle && path !== app ? { path, kind: 'bundle' } : null
  }
  if (!entry.isFile()) return null
  return isMachO(await readHeader({ path })) ? { path, kind: 'machO' } : null
}

/** Every regular Mach-O file and every nested `.app` or `.framework` inside the app; symlinks are skipped. */
export const listSignables = async ({ app }: { app: string }): Promise<Signable[]> => {
  const entries = await readdir(app, { recursive: true, withFileTypes: true })
  // Defensive: on the real app Bun and Node list the same entries, but a recursive readdir
  // that descended into a symlinked folder (a framework's Versions/Current) would list its
  // files twice, so whatever sits under a symlink is dropped by path.
  const links = entries.filter((entry) => entry.isSymbolicLink()).map(pathOf)
  const isUnderLink = (path: string) => links.some((link) => path.startsWith(`${link}${sep}`))
  const real = entries.filter((entry) => !entry.isSymbolicLink() && !isUnderLink(pathOf(entry)))
  // One file at a time: an Electron app holds hundreds, past macOS's default open file limit.
  return real.reduce<Promise<Signable[]>>(async (previous, entry) => {
    const found = await previous
    const signable = await signableOf({ app, entry })
    return signable === null ? found : [...found, signable]
  }, Promise.resolve([]))
}

export const adHocSignArgs = ({ path }: { path: string }): string[] => [
  '--sign',
  '-',
  '--force',
  path,
]

export const verifyAppArgs = ({ app }: { app: string }): string[] => [
  '--verify',
  '--deep',
  '--strict',
  '--verbose=2',
  app,
]

/** Runs a command to its end; rejects when it fails. */
export type RunCommand = (command: { command: string; args: string[] }) => Promise<unknown>

/** Signs every Mach-O and nested bundle in signing order, one at a time, then verifies the app. */
export const signAdHoc = async ({ app, run }: { app: string; run: RunCommand }): Promise<void> => {
  const entries = await listSignables({ app })
  await signingOrder({ app, entries }).reduce<Promise<unknown>>(
    (previous, path) =>
      previous.then(() => run({ command: 'codesign', args: adHocSignArgs({ path }) })),
    Promise.resolve(),
  )
  await run({ command: 'codesign', args: verifyAppArgs({ app }) })
}
