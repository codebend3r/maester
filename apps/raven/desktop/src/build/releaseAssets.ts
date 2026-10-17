import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { dmgFileName, versionOf } from '@/build/dmgMaker'

const RELEASE_DIR = join('out', 'release')
export const SOURCE_BUNDLE = join(
  '..',
  '..',
  '..',
  'libs',
  'raven',
  'mpv',
  'native-build',
  'source-bundle',
)

export const releaseAssetNames = ({ version }: { version: string }) =>
  ({
    dmg: `raven-player-${version}-arm64.dmg`,
    zip: `raven-player-${version}-arm64.zip`,
    sources: `raven-player-${version}-sources.tar.gz`,
    sums: 'SHA256SUMS',
  }) as const

/** The `shasum -a 256 -c` format: the digest, two spaces, the name. */
export const sha256Sums = (entries: readonly { name: string; sha256: string }[]): string =>
  entries
    .toSorted((a, b) => Number(a.name > b.name) - Number(a.name < b.name))
    .map(({ name, sha256 }) => `${sha256}  ${name}\n`)
    .join('')

export const sourcesFrom = (argv: readonly string[]): string => {
  const flag = argv.indexOf('--sources')
  if (flag === -1) return SOURCE_BUNDLE
  return argv[flag + 1] ?? SOURCE_BUNDLE
}

const run = promisify(execFile)

const sha256Of = async ({ path }: { path: string }): Promise<string> => {
  const hasher = new Bun.CryptoHasher('sha256')
  await Bun.file(path)
    .stream()
    .pipeTo(
      new WritableStream({
        write: (chunk) => {
          hasher.update(chunk)
        },
      }),
    )
  return hasher.digest('hex')
}

const writeReleaseAssets = async ({
  project,
  sources,
}: {
  project: string
  sources: string
}): Promise<number> => {
  const version = versionOf(JSON.parse(await readFile(join(project, 'package.json'), 'utf8')))
  const names = releaseAssetNames({ version })
  const release = join(project, RELEASE_DIR)
  const made = join(project, 'out', 'make')
  const dmg = join(made, 'dmg', 'darwin', 'arm64', dmgFileName({ version, arch: 'arm64' }))
  const zip = join(made, 'zip', 'darwin', 'arm64', `raven player-darwin-arm64-${version}.zip`)
  await rm(release, { recursive: true, force: true })
  await mkdir(release, { recursive: true })
  if (!existsSync(dmg) || !existsSync(zip)) {
    console.error('Run bunx nx run @raven/desktop:make first.')
    return 1
  }
  if (!existsSync(sources)) {
    console.error(
      'The source offer ships with the app: build libmpv first, or pass --sources <dir>.',
    )
    return 1
  }
  await copyFile(dmg, join(release, names.dmg))
  await copyFile(zip, join(release, names.zip))
  await run('tar', [
    '-czf',
    join(release, names.sources),
    '-C',
    dirname(sources),
    basename(sources),
  ])
  const assets = [names.dmg, names.zip, names.sources]
  const entries = await Promise.all(
    assets.map(async (name) => ({ name, sha256: await sha256Of({ path: join(release, name) }) })),
  )
  await writeFile(join(release, names.sums), sha256Sums(entries))
  process.stdout.write(
    `raven player ${version}: ${assets.length} assets and SHA256SUMS in ${release}\n`,
  )
  return 0
}

if (import.meta.main) {
  const project = join(import.meta.dirname, '..', '..')
  process.exitCode = await writeReleaseAssets({
    project,
    sources: resolve(project, sourcesFrom(process.argv.slice(2))),
  })
}
