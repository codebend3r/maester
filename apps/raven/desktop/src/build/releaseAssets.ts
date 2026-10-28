import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { NATIVE_TARGETS, type NativeTarget, nativeTargetOf } from '@raven/mpv'
import { dmgFileName, versionOf } from '@/build/dmgMaker'
import { appAssetNameFor } from '@/main/updates'

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

/** The architecture each target's asset names carry. */
const ASSET_ARCHS = {
  [NATIVE_TARGETS.darwinArm64]: 'arm64',
  [NATIVE_TARGETS.win32X64]: 'x64',
} as const satisfies Record<NativeTarget, string>

/**
 * macOS builds libmpv from source, so its release carries the source offer. The Windows
 * build ships a prebuilt libmpv whose sources are the release `windows.lock.json` pins,
 * which the install notes name instead.
 */
const SHIPS_SOURCES = {
  [NATIVE_TARGETS.darwinArm64]: true,
  [NATIVE_TARGETS.win32X64]: false,
} as const satisfies Record<NativeTarget, boolean>

type ReleaseAssetNamesProps = { version: string; target: NativeTarget }

/**
 * A target's release assets, which `publish` checksums together into one `SHA256SUMS`.
 * `app` is the download an update check looks for, the dmg or
 * the setup exe, so it takes the name `appAssetNameFor` gives.
 */
export const releaseAssetNames = ({ version, target }: ReleaseAssetNamesProps) =>
  ({
    app: appAssetNameFor({ version, target }),
    zip: `raven-player-${version}-${ASSET_ARCHS[target]}.zip`,
    sources: SHIPS_SOURCES[target] ? `raven-player-${version}-sources.tar.gz` : null,
  }) as const

type MadeFilesForProps = { version: string; target: NativeTarget }

/** Where Forge's makers write a target's app and zip, under `out/make`. */
export const madeFilesFor = ({ version, target }: MadeFilesForProps) => {
  switch (target) {
    case NATIVE_TARGETS.darwinArm64:
      return {
        app: join('dmg', 'darwin', 'arm64', dmgFileName({ version, arch: 'arm64' })),
        zip: join('zip', 'darwin', 'arm64', `Raven-darwin-arm64-${version}.zip`),
      } as const
    // Squirrel's maker names the setup exe `<app name>-<version> Setup.exe`.
    case NATIVE_TARGETS.win32X64:
      return {
        app: join('squirrel.windows', 'x64', `Raven-${version} Setup.exe`),
        zip: join('zip', 'win32', 'x64', `Raven-win32-x64-${version}.zip`),
      } as const
    default: {
      const unreachable: never = target
      return unreachable
    }
  }
}

export const sourcesFrom = (argv: readonly string[]): string => {
  const flag = argv.indexOf('--sources')
  if (flag === -1) return SOURCE_BUNDLE
  return argv[flag + 1] ?? SOURCE_BUNDLE
}

const run = promisify(execFile)

type WriteReleaseAssetsProps = {
  project: string
  sources: string
  target: NativeTarget
}

const writeReleaseAssets = async ({
  project,
  sources,
  target,
}: WriteReleaseAssetsProps): Promise<number> => {
  const version = versionOf(JSON.parse(await readFile(join(project, 'package.json'), 'utf8')))
  const names = releaseAssetNames({ version, target })
  const release = join(project, RELEASE_DIR)
  const made = madeFilesFor({ version, target })
  const app = join(project, 'out', 'make', made.app)
  const zip = join(project, 'out', 'make', made.zip)
  await rm(release, { recursive: true, force: true })
  await mkdir(release, { recursive: true })
  if (!existsSync(app) || !existsSync(zip)) {
    console.error('Run bunx nx run @raven/desktop:make first.')
    return 1
  }
  if (names.sources !== null && !existsSync(sources)) {
    console.error(
      'The source offer ships with the app: build libmpv first, or pass --sources <dir>.',
    )
    return 1
  }
  await copyFile(app, join(release, names.app))
  await copyFile(zip, join(release, names.zip))
  if (names.sources !== null)
    await run('tar', [
      '-czf',
      join(release, names.sources),
      '-C',
      dirname(sources),
      basename(sources),
    ])
  const assets = [names.app, names.zip, names.sources].filter((name) => name !== null)
  process.stdout.write(`Raven ${version}: ${assets.length} assets in ${release}\n`)
  return 0
}

if (import.meta.main) {
  const target = nativeTargetOf({ platform: process.platform, arch: process.arch })
  if (target === null)
    throw new Error(`Raven has no build for ${process.platform} ${process.arch}.`)
  const project = join(import.meta.dirname, '..', '..')
  process.exitCode = await writeReleaseAssets({
    project,
    sources: resolve(project, sourcesFrom(process.argv.slice(2))),
    target,
  })
}
