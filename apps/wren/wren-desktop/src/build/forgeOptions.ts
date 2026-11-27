import { join } from 'node:path'

/*
 * What forge.config.ts and the main process share. Forge loads its config with jiti, which does
 * not read tsconfig `paths`, so this file imports nothing from the project.
 */

/**
 * Wren's web app's build, from this project's folder. Forge copies it into the app's resources
 * under its own name, and unpackaged the web host serves it from here.
 */
export const WEB_DIST = join('..', 'wren-web', 'dist')

/**
 * The Wren mark as the app icon, from this project's folder and without an extension: the
 * packager adds `.icns` on macOS, and an unpackaged launch puts the `.png` in the Dock. The `.icns`
 * is made from the `.png` with `sips` and `iconutil` (`scripts/make_icon.sh`).
 */
export const APP_ICON = join('resources', 'icon')

/** What the dmg is named by: `wren-<version>-<arch>.dmg`. */
export const DMG_FILE_STEM = 'wren'

/** The macOS tool that seals a packaged app ad hoc. */
export const AD_HOC_SIGNER = 'codesign'

/** The packager's paths for what goes in the asar. */
const PACKAGED_PATHS = { project: '', manifest: '/package.json', dist: '/dist' } as const

export const FUSES = {
  RunAsNode: false,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  EnableCookieEncryption: true,
} as const

/** The environment variables a signed build names its Developer ID and notary profile in. */
export const SIGNING_ENV = {
  identity: 'RAVEN_SIGN_IDENTITY',
  notarizeProfile: 'RAVEN_NOTARIZE_PROFILE',
} as const

/** The environment a build reads, `process.env` or a test's own. */
type BuildEnv = Readonly<Record<string, string | undefined>>

export type Signing = { osxSign?: { identity: string }; osxNotarize?: { keychainProfile: string } }

/**
 * Developer ID signing and notarization, read from the environment, by the names Raven's build
 * reads: with no `RAVEN_SIGN_IDENTITY` (a local build, a fork) the app is signed ad hoc, and
 * notarizing needs an identity too.
 */
export const signingFrom = (env: BuildEnv): Signing => {
  const identity = env[SIGNING_ENV.identity] ?? ''
  if (identity === '') return {}
  const keychainProfile = env[SIGNING_ENV.notarizeProfile] ?? ''
  if (keychainProfile === '') return { osxSign: { identity } }
  return { osxSign: { identity }, osxNotarize: { keychainProfile } }
}

/**
 * What goes in the asar, as the packager names paths: relative to the project, with a leading
 * slash, and '' for the project itself. Main is a self-contained bundle, so Bun's symlinked
 * node_modules stays out along with the sources.
 */
export const isPackagedPath = (file: string): boolean =>
  file === PACKAGED_PATHS.project ||
  file === PACKAGED_PATHS.manifest ||
  file === PACKAGED_PATHS.dist ||
  file.startsWith(`${PACKAGED_PATHS.dist}/`)

type AdHocArgsProps = { app: string }

/**
 * `codesign`'s arguments to seal a packaged app ad hoc when no identity signs it, so Apple
 * silicon runs it: Wren holds no code outside the places `--deep` signs (no addon, no libmpv).
 */
export const adHocArgs = ({ app }: AdHocArgsProps): string[] => [
  '--force',
  '--deep',
  '--sign',
  '-',
  app,
]
