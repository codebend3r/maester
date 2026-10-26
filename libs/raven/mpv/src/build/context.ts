import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isString, listOf, object, type Infer } from '@raven/core'

const PLATFORMS = { darwin: 'darwin' } as const satisfies Record<string, NodeJS.Platform>
export const ARCHITECTURES = {
  arm64: 'arm64',
} as const satisfies Record<string, NodeJS.Architecture>
/** The platform a native build is for, as its provenance records it. */
export const BUILD_TARGETS = { darwinArm64: 'darwin-arm64' } as const

export const project = fileURLToPath(new URL('../..', import.meta.url))
export const work = resolve(project, 'native-build')
export const prefix = resolve(work, 'prefix')
export const resources = resolve(project, 'resources/darwin-arm64')
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
export const requireMacArm = () => {
  if (process.platform !== PLATFORMS.darwin || process.arch !== ARCHITECTURES.arm64)
    throw new Error('Native playback supports macOS arm64 only')
}
