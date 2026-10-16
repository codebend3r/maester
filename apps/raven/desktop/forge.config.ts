import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { MakerZIP } from '@electron-forge/maker-zip'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import type { ForgeConfig } from '@electron-forge/shared-types'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { VIDEO_EXTENSIONS } from '@raven/core'
import {
  adHocSealArgs,
  documentTypes,
  FUSES,
  isPackagedPath,
  signingFrom,
} from './src/build/forgeOptions'

const APP_NAME = 'raven player'
const signing = signingFrom(process.env)
const run = promisify(execFile)

const config: ForgeConfig = {
  packagerConfig: {
    name: APP_NAME,
    executableName: APP_NAME,
    appBundleId: 'io.github.codebend3r.raven',
    appCategoryType: 'public.app-category.video',
    asar: { unpack: '**/*.node' },
    // Bun's node_modules is symlinks into a shared store; main and preload are bundled, so
    // the asar holds dist and package.json alone.
    prune: false,
    ignore: (file) => !isPackagedPath(file),
    protocols: [{ name: 'raven link', schemes: ['raven'] }],
    extendInfo: documentTypes(VIDEO_EXTENSIONS),
    ...signing,
  },
  makers: [new MakerZIP({}, ['darwin'])],
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
    // seals the final bundle, so it is resealed ad hoc here.
    postPackage: async (_forgeConfig, { platform, outputPaths }) => {
      if (platform !== 'darwin' || signing.osxSign !== undefined) return
      await Promise.all(
        outputPaths.map((folder) =>
          run('codesign', adHocSealArgs({ app: join(folder, `${APP_NAME}.app`) })),
        ),
      )
    },
  },
}

export default config
