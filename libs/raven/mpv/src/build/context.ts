import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isString, listOf, object, type Infer } from '@raven/core'
import { ARCHITECTURES, NATIVE_TARGETS, PLATFORMS } from '@/target'
import type { NativeTarget } from '@/target'

/** The patches applied to mpv's sources, in order; the build's provenance records each one's digest. */
export const PATCHES = [
  '0001-player-add-moltenvk-context.patch',
  '0002-moltenvk-resize.patch',
] as const

/** The libraries shipped under `resources/lib`, each finding the other by `@rpath`. */
export const SHIPPED_LIBRARIES = ['libMoltenVK.dylib', 'libmpv.2.dylib'] as const

export const project = fileURLToPath(new URL('../..', import.meta.url))
export const work = resolve(project, 'native-build')
export const prefix = resolve(work, 'prefix')

type ResourcesOfProps = {
  target: NativeTarget
}

/** Where a target's runtime files land: the addon, libmpv and their provenance. */
const resourcesOf = ({ target }: ResourcesOfProps) => resolve(project, 'resources', target)
export const resources = resourcesOf({ target: NATIVE_TARGETS.darwinArm64 })
export const windowsResources = resourcesOf({ target: NATIVE_TARGETS.win32X64 })
const isSourceShape = object({
  name: isString,
  repository: isString,
  version: isString,
  commit: isString,
  url: isString,
  sha256: isString,
  license: isString,
})
export const isSource = (value: unknown): value is Infer<typeof isSourceShape> =>
  isSourceShape(value) &&
  /^[a-zA-Z0-9_-]+$/.test(value.name) &&
  /^[a-f0-9]{40}$/.test(value.commit) &&
  /^[a-f0-9]{64}$/.test(value.sha256) &&
  /^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(value.repository) &&
  value.url ===
    `${value.repository.replace('github.com', 'codeload.github.com')}/tar.gz/${value.commit}`
export const digest = (content: Uint8Array | string) =>
  createHash('sha256').update(content).digest('hex')
export const sources = async () => {
  const value: unknown = JSON.parse(
    await readFile(resolve(project, 'native/sources.lock.json'), 'utf8'),
  )
  if (!listOf(isSource)(value)) throw new Error('Invalid native source lock')
  return value
}

type CheckedDownloadProps = {
  path: string
  url: string
  sha256: string
  /** What is being fetched, for the error. */
  what: string
}

/** Downloads a pinned file once; a cached or fetched copy whose digest differs fails. */
export const checkedDownload = async ({ path, url, sha256, what }: CheckedDownloadProps) => {
  const file = Bun.file(path)
  if (await file.exists()) {
    if (digest(await file.bytes()) !== sha256) throw new Error(`Cached digest mismatch: ${what}`)
    return
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`Download failed: ${what} (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (digest(bytes) !== sha256) throw new Error(`Digest mismatch: ${what}`)
  await write({ path, content: bytes })
}

type RunProps = {
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

export const run = async ({ args, cwd = project, env = {} }: RunProps) => {
  const child = Bun.spawn(args, {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if ((await child.exited) !== 0) throw new Error(`Native build command failed: ${args[0]}`)
}
type OutputProps = {
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

export const output = async ({ args, cwd = project, env = {} }: OutputProps) => {
  const child = Bun.spawn(args, {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'inherit',
  })
  const text = await new Response(child.stdout).text()
  if ((await child.exited) !== 0) throw new Error(`Native inspection failed: ${args[0]}`)
  return text.trim()
}
type WriteProps = { path: string; content: string | Uint8Array }

export const write = async ({ path, content }: WriteProps) => {
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, content)
}
type InSequenceProps<T> = {
  items: readonly T[]
  each: (item: T) => Promise<void>
}

/** Runs `each` over `items` one at a time, in order: the build steps share one prefix, and the archives one disk. */
export const inSequence = async <T>({ items, each }: InSequenceProps<T>): Promise<void> => {
  await items.reduce(async (previous, item) => {
    await previous
    await each(item)
  }, Promise.resolve())
}

export const isWindows = () => process.platform === PLATFORMS.win32

// Windows' tar is bsdtar in System32. A Git for Windows bash puts GNU tar first on PATH,
// and that one reads `D:\\...` as a host name.
const ENV_NAMES = { systemRoot: 'SystemRoot' } as const
export const TAR = isWindows()
  ? join(process.env[ENV_NAMES.systemRoot] ?? 'C:\\Windows', 'System32', 'tar.exe')
  : 'tar'

export const requireMacArm = () => {
  if (process.platform !== PLATFORMS.darwin || process.arch !== ARCHITECTURES.arm64)
    throw new Error('Native playback supports macOS arm64 only')
}
