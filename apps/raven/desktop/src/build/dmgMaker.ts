import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { type EmptyConfig, MakerBase, type MakerOptions } from '@electron-forge/maker-base'
import type { ForgePlatform } from '@electron-forge/shared-types'

/**
 * Makes the dmg with macOS's own `ditto` and `hdiutil` rather than
 * `@electron-forge/maker-dmg`, whose `appdmg` backend needs node-gyp addons that Bun never
 * builds. forge.config.ts imports this file through jiti, which does not read tsconfig
 * `paths`, so it imports nothing from the project.
 */

export const PLATFORMS = { darwin: 'darwin' } as const satisfies Record<string, NodeJS.Platform>

/** The macOS tools the dmg is made with. */
export const DMG_TOOLS = { ditto: 'ditto', hdiutil: 'hdiutil' } as const

export const dmgFileName = ({ version, arch }: { version: string; arch: string }): string =>
  `raven-player-${version}-${arch}.dmg`

export const hdiutilArgs = ({
  volumeName,
  sourceDir,
  output,
}: {
  volumeName: string
  sourceDir: string
  output: string
}): string[] => [
  'create',
  '-volname',
  volumeName,
  '-srcfolder',
  sourceDir,
  '-format',
  'UDZO',
  '-ov',
  output,
]

export const versionOf = (packageJSON: unknown): string => {
  if (
    typeof packageJSON !== 'object' ||
    packageJSON === null ||
    !('version' in packageJSON) ||
    typeof packageJSON.version !== 'string' ||
    packageJSON.version.length === 0
  ) {
    throw new Error('package.json has no version')
  }
  return packageJSON.version
}

/** Runs a command to its end; rejects when it fails. */
export type RunCommand = (command: { command: string; args: string[] }) => Promise<unknown>

const execFileAsync = promisify(execFile)
const runCommand: RunCommand = ({ command, args }) => execFileAsync(command, args)

export const makeDmg = async ({
  dir,
  makeDir,
  appName,
  packageJSON,
  targetArch,
  run,
}: {
  dir: string
  makeDir: string
  appName: string
  packageJSON: unknown
  targetArch: string
  run: RunCommand
}): Promise<string[]> => {
  const outputDir = join(makeDir, 'dmg', 'darwin', targetArch)
  const output = join(outputDir, dmgFileName({ version: versionOf(packageJSON), arch: targetArch }))
  const bundle = `${appName}.app`
  await mkdir(outputDir, { recursive: true })
  const stage = await mkdtemp(join(tmpdir(), 'raven-dmg-'))
  try {
    // ditto keeps the signatures, extended attributes and framework symlinks intact.
    await run({ command: DMG_TOOLS.ditto, args: [join(dir, bundle), join(stage, bundle)] })
    await symlink('/Applications', join(stage, 'Applications'))
    await run({
      command: DMG_TOOLS.hdiutil,
      args: hdiutilArgs({ volumeName: appName, sourceDir: stage, output }),
    })
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
  return [output]
}

export class MakerDmg extends MakerBase<EmptyConfig> {
  name = 'dmg'

  defaultPlatforms: ForgePlatform[] = [PLATFORMS.darwin]

  override requiredExternalBinaries: string[] = [DMG_TOOLS.ditto, DMG_TOOLS.hdiutil]

  override isSupportedOnCurrentPlatform(): boolean {
    return process.platform === PLATFORMS.darwin
  }

  override async make({
    dir,
    makeDir,
    appName,
    packageJSON,
    targetArch,
  }: MakerOptions): Promise<string[]> {
    return makeDmg({ dir, makeDir, appName, packageJSON, targetArch, run: runCommand })
  }
}
