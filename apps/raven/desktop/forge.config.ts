import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerZIP } from '@electron-forge/maker-zip'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import type { ForgeConfig } from '@electron-forge/shared-types'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { VIDEO_EXTENSIONS } from '@raven/core'
import { MakerDmg } from './src/build/dmgMaker'
import {
  adHocApps,
  APP_ICON,
  documentTypes,
  FUSES,
  isPackagedPath,
  signingFrom,
  WEB_DIST,
  WINDOWS_ICON,
} from './src/build/forgeOptions'
import { type RunCommand, signAdHoc } from './src/build/machO'
import { MPV_STAGING } from './src/build/stageMpv'
import { LINK_SCHEME } from './src/shared/playLink'

const APP_NAME = 'Raven'
const AUTHOR = 'CJ Rivas'
// Squirrel's package id, which names the install folder under %LOCALAPPDATA%: NuGet takes no
// `@` or `/`, so the package name cannot serve.
const SQUIRREL_ID = 'raven'
// What Windows' installed apps list shows for Raven; Squirrel takes a URL only.
const ICON_URL =
  'https://raw.githubusercontent.com/codebend3r/maester/main/apps/raven/desktop/resources/icon.ico'
const PLATFORMS = { darwin: 'darwin', win32: 'win32' } as const satisfies Record<
  string,
  NodeJS.Platform
>
const signing = signingFrom(process.env)
const execFileAsync = promisify(execFile)
const run: RunCommand = ({ command, args }) => execFileAsync(command, args)

const config: ForgeConfig = {
  packagerConfig: {
    name: APP_NAME,
    executableName: APP_NAME,
    appBundleId: 'io.github.codebend3r.raven',
    appCategoryType: 'public.app-category.video',
    icon: APP_ICON,
    asar: { unpack: '**/*.node' },
    // Bun's node_modules is symlinks into a shared store; main and preload are bundled, so
    // the asar holds dist and package.json alone.
    prune: false,
    ignore: (file) => !isPackagedPath(file),
    protocols: [{ name: 'raven link', schemes: [LINK_SCHEME] }],
    extendInfo: documentTypes(VIDEO_EXTENSIONS),
    // Task Manager and the Start menu shortcut Squirrel makes read Raven.exe's version info.
    win32metadata: { ProductName: APP_NAME, FileDescription: APP_NAME, CompanyName: AUTHOR },
    // stage:mpv fills staging/mpv/<target>, so it lands at Contents/Resources/mpv/darwin-arm64 on
    // macOS and resources/mpv/win32-x64 on Windows; the web app's build (a dependency of this
    // project's build) lands at Contents/Resources/dist or resources/dist.
    extraResource: [MPV_STAGING, WEB_DIST],
    ...signing,
  },
  makers: [
    new MakerDmg({}, [PLATFORMS.darwin]),
    new MakerZIP({}, [PLATFORMS.darwin, PLATFORMS.win32]),
    new MakerSquirrel(
      { name: SQUIRREL_ID, authors: AUTHOR, setupIcon: WINDOWS_ICON, iconUrl: ICON_URL },
      [PLATFORMS.win32],
    ),
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: FUSES.RunAsNode,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]:
        FUSES.EnableNodeOptionsEnvironmentVariable,
      [FuseV1Options.EnableNodeCliInspectArguments]: FUSES.EnableNodeCliInspectArguments,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:
        FUSES.EnableEmbeddedAsarIntegrityValidation,
      [FuseV1Options.OnlyLoadAppFromAsar]: FUSES.OnlyLoadAppFromAsar,
      [FuseV1Options.EnableCookieEncryption]: FUSES.EnableCookieEncryption,
    }),
  ],
  hooks: {
    // An identity signs through osxSign after the packager is done; without one, nothing
    // seals the final bundle, so every Mach-O in it is signed ad hoc here, inside out.
    postPackage: async (_forgeConfig, { platform, outputPaths }) => {
      await adHocApps({ platform, signing, outputPaths, appName: APP_NAME }).reduce<Promise<void>>(
        (previous, app) => previous.then(() => signAdHoc({ app, run })),
        Promise.resolve(),
      )
    },
  },
}

export default config
