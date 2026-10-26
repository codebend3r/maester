import { existsSync } from 'node:fs'
import { cp, rm } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Copies the CI-built addon and libmpv beside the desktop project, where Forge's
 * `extraResource` picks them up. forge.config.ts imports this file through jiti, which does
 * not read tsconfig `paths`, so it imports nothing from the project.
 */

const MPV_SOURCE = join('..', '..', '..', 'libs', 'raven', 'mpv', 'resources', 'darwin-arm64')
export const MPV_STAGING = join('staging', 'mpv')
export const MPV_FILES = {
  addon: 'raven_mpv.node',
  libmpv: 'lib/libmpv.2.dylib',
  moltenVk: 'lib/libMoltenVK.dylib',
} as const
export const MPV_MACH_O = [MPV_FILES.addon, MPV_FILES.libmpv, MPV_FILES.moltenVk] as const
export const STAGED_PATHS = [...MPV_MACH_O, 'provenance'] as const

type MissingMpvFilesProps = { exists: (relative: string) => boolean }

export const missingMpvFiles = ({ exists }: MissingMpvFilesProps): string[] =>
  MPV_MACH_O.filter((relative) => !exists(relative))

type CopyProps = { from: string; to: string }

type StageFs = {
  exists: (path: string) => boolean
  remove: (path: string) => Promise<void>
  copy: (paths: CopyProps) => Promise<void>
}

type StageMpvProps = {
  from: string
  to: string
  fs: StageFs
}

export const stageMpv = async ({ from, to, fs }: StageMpvProps): Promise<void> => {
  const missing = missingMpvFiles({ exists: (relative) => fs.exists(join(from, relative)) })
  if (missing.length > 0) {
    throw new Error(
      `Raven packages the video engine, and these are missing from ${from}: ${missing.join(', ')}. CI builds them (bunx nx run @raven/mpv:build:native).`,
    )
  }
  await fs.remove(to)
  await STAGED_PATHS.reduce(
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
  const project = join(import.meta.dirname, '..', '..')
  await stageMpv({
    from: join(project, MPV_SOURCE),
    to: join(project, MPV_STAGING, 'darwin-arm64'),
    fs: realFs,
  })
}
