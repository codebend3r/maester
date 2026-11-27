import { join } from 'node:path'

/*
 * The tested half of forge.config.ts. Forge loads its config with jiti, which does not read
 * tsconfig `paths`, so this file imports nothing from the project.
 */

const PLATFORMS = { darwin: 'darwin' } as const satisfies Record<string, NodeJS.Platform>

/**
 * The web app's build, from this project's folder. Forge copies it into the app's resources
 * under its own name, and unpackaged the web host serves it from here.
 */
export const WEB_DIST = join('..', 'web', 'dist')

/** What the dmg is named by: `raven-player-<version>-<arch>.dmg`. */
export const DMG_FILE_STEM = 'raven-player'

/**
 * The fonts mpv draws subtitles with, from this project's folder. Forge copies the folder into
 * the app's resources under its own name, and unpackaged mpv reads it from here.
 */
export const FONTS = join('resources', 'fonts')

/**
 * The raven logo as the app icon, from this project's folder and without an extension: the
 * packager adds `.icns` and `.icon` on macOS and `.ico` on Windows, and an unpackaged launch
 * puts the `.png` in the Dock. The `.ico` is made from the `.png` with ImageMagick:
 * `magick icon.png -depth 8 -define icon:auto-resize=256,128,64,48,32,16 icon.ico`.
 *
 * The `.icon` is the Icon Composer document macOS 26 and later draw: the logo on a full-bleed
 * ground the system masks itself. Those systems shrink the `.icns`, which draws its own rounded
 * square, onto a grey plate, so it stays only for the older ones. Compiling the `.icon` takes
 * Xcode 26 or later.
 */
export const APP_ICON = join('resources', 'icon')

/** The icon Squirrel's setup exe carries, which needs the `.ico` by its full name. */
export const WINDOWS_ICON = `${APP_ICON}.ico`

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

export type Signing = { osxSign?: { identity: string }; osxNotarize?: { keychainProfile: string } }

/**
 * Developer ID signing and notarization, read from the environment: with no
 * `RAVEN_SIGN_IDENTITY` (a local build, a fork) the app is signed ad hoc, and notarizing
 * needs an identity too.
 */
export const signingFrom = (env: Readonly<Record<string, string | undefined>>): Signing => {
  const identity = env.RAVEN_SIGN_IDENTITY ?? ''
  if (identity === '') return {}
  const keychainProfile = env.RAVEN_NOTARIZE_PROFILE ?? ''
  if (keychainProfile === '') return { osxSign: { identity } }
  return { osxSign: { identity }, osxNotarize: { keychainProfile } }
}

/**
 * What goes in the asar, as the packager names paths: relative to the project, with a
 * leading slash, and '' for the project itself. Main and preload are self-contained bundles,
 * so Bun's symlinked node_modules stays out along with the sources.
 */
export const isPackagedPath = (file: string): boolean =>
  file === PACKAGED_PATHS.project ||
  file === PACKAGED_PATHS.manifest ||
  file === PACKAGED_PATHS.dist ||
  file.startsWith(`${PACKAGED_PATHS.dist}/`)

type AdHocAppsProps = {
  platform: string
  signing: Signing
  outputPaths: readonly string[]
  appName: string
}

/**
 * The packaged apps to sign ad hoc: none off macOS, and none when an identity signs the app
 * through osxSign after the packager is done. The fuses plugin re-signs right after flipping
 * the fuses, but the packager then renames the executables and writes the final Info.plist,
 * which breaks that seal; an app with a broken seal is "damaged" to Gatekeeper once
 * downloaded.
 */
export const adHocApps = ({
  platform,
  signing,
  outputPaths,
  appName,
}: AdHocAppsProps): string[] => {
  if (platform !== PLATFORMS.darwin || signing.osxSign !== undefined) return []
  return outputPaths.map((folder) => join(folder, `${appName}.app`))
}
