import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { isString, listOf, object } from '@raven/core'
import { project } from '@/build/context'

const TASKS = {
  fetch: 'fetch:libmpv',
  build: 'build:native',
  audit: 'audit:native',
  test: 'test:native',
  unit: 'test',
  root: 'mpv:native',
} as const
const isTask = object({ dependsOn: listOf(isString) })
const isNativePackage = object({
  scripts: object({ [TASKS.unit]: isString }),
  nx: object({
    targets: object({
      [TASKS.build]: object({
        dependsOn: listOf(isString),
        cache: (value: unknown): value is false => value === false,
      }),
      [TASKS.audit]: isTask,
      [TASKS.test]: isTask,
    }),
  }),
})
const isRootPackage = object({ scripts: object({ [TASKS.root]: isString }) })

const readNativePackage = async () => {
  const value: unknown = await Bun.file(resolve(project, 'package.json')).json()
  if (!isNativePackage(value)) throw new Error('Invalid native task configuration')
  return value
}

describe('native task prerequisites', () => {
  test('builds the pinned runtime before refreshing the current HEAD source receipt', async () => {
    const config = await readNativePackage()
    expect(config.nx.targets[TASKS.build].dependsOn).toContain(TASKS.fetch)
    expect(config.nx.targets[TASKS.build].cache).toBe(false)
  })

  test('audit and tests wait for the uncached addon and source receipt refresh', async () => {
    const config = await readNativePackage()
    expect(config.nx.targets[TASKS.audit].dependsOn).toContain(TASKS.build)
    expect(config.nx.targets[TASKS.test].dependsOn).toContain(TASKS.build)
  })

  test('unit tests do not rediscover tests copied into the generated source bundle', async () => {
    const config = await readNativePackage()
    expect(config.scripts[TASKS.unit]).toContain('--path-ignore-patterns=native-build')
  })

  test('the root command selects full Xcode without a shell export and respects overrides', async () => {
    const value: unknown = await Bun.file(resolve(project, '../../../package.json')).json()
    if (!isRootPackage(value)) throw new Error('Invalid root native command')
    expect(value.scripts[TASKS.root]).toStartWith(
      'DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer} ',
    )
  })
})
