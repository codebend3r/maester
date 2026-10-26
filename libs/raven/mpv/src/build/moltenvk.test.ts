import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { moltenvkBuildCommands } from '@/build/moltenvk'

type ArgumentProps = { args: string[]; name: string }

const argument = ({ args, name }: ArgumentProps) => {
  const index = args.indexOf(name)
  const value = args.at(index + 1)
  if (index < 0 || !value) throw new Error(`Missing build argument: ${name}`)
  return value
}

test('MoltenVK packaging cannot remove either active Xcode build database', async () => {
  const buildRoot = await mkdtemp(join(tmpdir(), 'raven-moltenvk-'))
  try {
    const source = resolve(buildRoot, 'sources/moltenvk')
    const commands = moltenvkBuildCommands({ source, buildRoot })
    const cleanupPath = resolve(source, 'External/build/Intermediates')
    await mkdir(cleanupPath, { recursive: true })
    const databases = commands.map((command) => {
      const derivedData = argument({ args: command.args, name: '-derivedDataPath' })
      const fromCleanup = relative(cleanupPath, derivedData)
      expect(fromCleanup.startsWith(`..${sep}`)).toBe(true)
      expect(command.cwd).toBe(source)
      expect(command.args.some((value) => value.startsWith('SKIP_PACKAGING='))).toBe(false)
      expect(command.args).toContain('ARCHS=arm64')
      return resolve(derivedData, 'Build/Intermediates.noindex/XCBuildData/build.db')
    })
    expect(new Set(databases).size).toBe(2)
    await Promise.all(
      databases.map(async (database) => {
        await mkdir(dirname(database), { recursive: true })
        await writeFile(database, 'active build database fixture')
      }),
    )
    await rm(cleanupPath, { recursive: true })
    await Promise.all(
      databases.map(async (database) => {
        expect(await readFile(database, 'utf8')).toBe('active build database fixture')
      }),
    )
    expect(commands.map((command) => argument({ args: command.args, name: '-project' }))).toEqual([
      'ExternalDependencies.xcodeproj',
      'MoltenVKPackaging.xcodeproj',
    ])
  } finally {
    await rm(buildRoot, { recursive: true, force: true })
  }
})
