import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { MakerBase, type MakerOptions } from '@electron-forge/maker-base'
import type { ForgePlatform } from '@electron-forge/shared-types'

/*
 * Makes the dmg with macOS's own `ditto` and `hdiutil` rather than
 * `@electron-forge/maker-dmg`, whose `appdmg` backend needs node-gyp addons that Bun never
 * builds. Each desktop app's forge.config.ts makes one with its own file stem.
 */

export const PLATFORMS = { darwin: 'darwin' } as const satisfies Record<string, NodeJS.Platform>

/** The macOS tools the dmg is made with. */
export const DMG_TOOLS = { ditto: 'ditto', hdiutil: 'hdiutil' } as const

/** What a dmg's file is named from: `<stem>-<version>-<arch>.dmg`. */
type DmgFileNameProps = { fileStem: string; version: string; arch: string }

export const dmgFileName = ({ fileStem, version, arch }: DmgFileNameProps): string =>
  `${fileStem}-${version}-${arch}.dmg`

type HdiutilArgsProps = {
  volumeName: string
  sourceDir: string
  output: string
}

export const hdiutilArgs = ({ volumeName, sourceDir, output }: HdiutilArgsProps): string[] => [
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

type RunCommandProps = { command: string; args: string[] }

/** Runs a command to its end; rejects when it fails. */
type RunCommand = (command: RunCommandProps) => Promise<unknown>

const execFileAsync = promisify(execFile)
const runCommand: RunCommand = ({ command, args }) => execFileAsync(command, args)

type MakeDmgProps = {
  fileStem: string
  dir: string
  makeDir: string
  appName: string
  packageJSON: unknown
  targetArch: string
  run: RunCommand
}

export const makeDmg = async ({
  fileStem,
  dir,
  makeDir,
  appName,
  packageJSON,
  targetArch,
  run,
}: MakeDmgProps): Promise<string[]> => {
  const outputDir = join(makeDir, 'dmg', PLATFORMS.darwin, targetArch)
  const output = join(
    outputDir,
    dmgFileName({ fileStem, version: versionOf(packageJSON), arch: targetArch }),
  )
  const bundle = `${appName}.app`
  await mkdir(outputDir, { recursive: true })
  const stage = await mkdtemp(join(tmpdir(), `${fileStem}-dmg-`))
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

/** What a desktop app's dmg maker is made with: the stem its files are named by. */
export type DmgConfig = { fileStem: string }

export class MakerDmg extends MakerBase<DmgConfig> {
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
    return makeDmg({
      fileStem: this.config.fileStem,
      dir,
      makeDir,
      appName,
      packageJSON,
      targetArch,
      run: runCommand,
    })
  }
}
