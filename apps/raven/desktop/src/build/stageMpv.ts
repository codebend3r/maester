import { existsSync } from 'node:fs'
import { cp, rm } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Copies the CI-built addon and libmpv beside the desktop project, where Forge's
 * `extraResource` picks them up. forge.config.ts imports this file through jiti, which does
 * not read tsconfig `paths`, so it imports nothing from the project.
 */

/**
 * `@raven/mpv`'s `NATIVE_TARGETS`, spelled here because this file imports nothing from the
 * project; stageMpv.test.ts checks the two agree.
 */
export const STAGE_TARGETS = { darwinArm64: 'darwin-arm64', win32X64: 'win32-x64' } as const

export type StageTarget = (typeof STAGE_TARGETS)[keyof typeof STAGE_TARGETS]

const PLATFORMS = { darwin: 'darwin', win32: 'win32' } as const satisfies Record<
  string,
  NodeJS.Platform
>
const ARCHITECTURES = { arm64: 'arm64', x64: 'x64' } as const satisfies Record<
  string,
  NodeJS.Architecture
>

const MPV_RESOURCES = join('..', '..', '..', 'libs', 'raven', 'mpv', 'resources')
export const MPV_STAGING = join('staging', 'mpv')
const PROVENANCE = 'provenance'
export const MPV_FILES = {
  addon: 'raven_mpv.node',
  libmpv: 'lib/libmpv.2.dylib',
  moltenVk: 'lib/libMoltenVK.dylib',
} as const
export const WINDOWS_MPV_FILES = { addon: 'raven_mpv.node', libmpv: 'libmpv-2.dll' } as const
export const MPV_MACH_O = [MPV_FILES.addon, MPV_FILES.libmpv, MPV_FILES.moltenVk] as const
export const MPV_PE = [WINDOWS_MPV_FILES.addon, WINDOWS_MPV_FILES.libmpv] as const

/** The engine's binaries for each target, which a package without them could not play. */
const MPV_BINARIES = {
  [STAGE_TARGETS.darwinArm64]: MPV_MACH_O,
  [STAGE_TARGETS.win32X64]: MPV_PE,
} as const satisfies Record<StageTarget, readonly string[]>

/** The native build each target's files come from, for the error that finds them missing. */
const BUILD_COMMANDS = {
  [STAGE_TARGETS.darwinArm64]: 'bunx nx run @raven/mpv:build:native',
  [STAGE_TARGETS.win32X64]: 'bunx nx run @raven/mpv:build:native:windows',
} as const satisfies Record<StageTarget, string>

type StagedPathsForProps = { target: StageTarget }

/** What is staged for a target, in copy order: its binaries, then their provenance. */
export const stagedPathsFor = ({ target }: StagedPathsForProps): string[] => [
  ...MPV_BINARIES[target],
  PROVENANCE,
]

type StageTargetOfProps = {
  platform: NodeJS.Platform
  arch: NodeJS.Architecture
}

/** The target this machine packages, or null where raven has no build. */
export const stageTargetOf = ({ platform, arch }: StageTargetOfProps): StageTarget | null => {
  if (platform === PLATFORMS.darwin && arch === ARCHITECTURES.arm64) {
    return STAGE_TARGETS.darwinArm64
  }
  if (platform === PLATFORMS.win32 && arch === ARCHITECTURES.x64) return STAGE_TARGETS.win32X64
  return null
}

type MissingMpvFilesProps = {
  target: StageTarget
  exists: (relative: string) => boolean
}

export const missingMpvFiles = ({ target, exists }: MissingMpvFilesProps): string[] =>
  MPV_BINARIES[target].filter((relative) => !exists(relative))

type CopyProps = { from: string; to: string }

type StageFs = {
  exists: (path: string) => boolean
  remove: (path: string) => Promise<void>
  copy: (paths: CopyProps) => Promise<void>
}

type StageMpvProps = {
  target: StageTarget
  /** The target's folder of `@raven/mpv`'s resources. */
  from: string
  /** The staging folder Forge ships whole, which holds the target's folder alone. */
  staging: string
  fs: StageFs
}

export const stageMpv = async ({ target, from, staging, fs }: StageMpvProps): Promise<void> => {
  const missing = missingMpvFiles({ target, exists: (relative) => fs.exists(join(from, relative)) })
  if (missing.length > 0) {
    throw new Error(
      `Raven packages the video engine, and these are missing from ${from}: ${missing.join(', ')}. CI builds them (${BUILD_COMMANDS[target]}).`,
    )
  }
  // The whole staging folder, so a target staged earlier on this machine is not shipped too.
  await fs.remove(staging)
  const to = join(staging, target)
  await stagedPathsFor({ target }).reduce(
    (previous, path) =>
      previous.then(() => fs.copy({ from: join(from, path), to: join(to, path) })),
    Promise.resolve(),
  )
}

const realFs: StageFs = {
  exists: existsSync,
  remove: (path) => rm(path, { recursive: true, force: true }),
  copy: ({ from, to }) => cp(from, to, { recursive: true, verbatimSymlinks: true }),
}

if (import.meta.main) {
  const target = stageTargetOf({ platform: process.platform, arch: process.arch })
  if (target === null) {
    throw new Error(`Raven has no video engine build for ${process.platform} ${process.arch}.`)
  }
  const project = join(import.meta.dirname, '..', '..')
  await stageMpv({
    target,
    from: join(project, MPV_RESOURCES, target),
    staging: join(project, MPV_STAGING),
    fs: realFs,
  })
}
