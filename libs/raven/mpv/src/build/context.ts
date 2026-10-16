import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isString, listOf, object, type Infer } from '@raven/core'

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
export type Source = Infer<typeof isSource>
export const digest = (content: Uint8Array | string) =>
  createHash('sha256').update(content).digest('hex')
export const sources = async () => {
  const value: unknown = JSON.parse(
    await readFile(resolve(project, 'native/sources.lock.json'), 'utf8'),
  )
  if (!listOf(isSource)(value)) throw new Error('Invalid native source lock')
  return value
}

export const run = async ({
  args,
  cwd = project,
  env = {},
}: {
  args: string[]
  cwd?: string
  env?: Record<string, string>
}) => {
  const child = Bun.spawn(args, {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if ((await child.exited) !== 0) throw new Error(`Native build command failed: ${args[0]}`)
}
export const output = async ({
  args,
  cwd = project,
  env = {},
}: {
  args: string[]
  cwd?: string
  env?: Record<string, string>
}) => {
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
export const write = async ({ path, content }: { path: string; content: string | Uint8Array }) => {
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, content)
}
export const requireMacArm = () => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('Native playback supports macOS arm64 only')
}
