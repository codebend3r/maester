import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { MakerZIP } from '@electron-forge/maker-zip'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import type { ForgeConfig } from '@electron-forge/shared-types'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { MakerDmg, PLATFORMS } from '@shared/desktop/build'
// Forge loads this file through jiti, which reads no tsconfig `paths`: relative imports only.
import {
  AD_HOC_SIGNER,
  APP_ICON,
  DMG_FILE_STEM,
  FUSES,
  WEB_DIST,
  adHocArgs,
  isPackagedPath,
  signingFrom,
} from './src/build/forgeOptions'

const APP_NAME = 'Wren'
const signing = signingFrom(process.env)
const run = promisify(execFile)

const config: ForgeConfig = {
  packagerConfig: {
    name: APP_NAME,
    executableName: APP_NAME,
    appBundleId: 'io.github.codebend3r.wren',
    appCategoryType: 'public.app-category.music',
    icon: APP_ICON,
    // Bun's node_modules is symlinks into a shared store; main is bundled, so the asar holds dist and package.json alone.
    prune: false,
    ignore: (file) => !isPackagedPath(file),
    // The web app's build lands at Contents/Resources/dist, where the web host serves it from.
    extraResource: [WEB_DIST],
    ...signing,
  },
  makers: [
    new MakerDmg({ fileStem: DMG_FILE_STEM }, [PLATFORMS.darwin]),
    new MakerZIP({}, [PLATFORMS.darwin]),
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
    // An identity signs through osxSign; without one, the final bundle is sealed ad hoc here.
    postPackage: async (_forgeConfig, { platform, outputPaths }) => {
      if (platform !== PLATFORMS.darwin || signing.osxSign !== undefined) return
      await Promise.all(
        outputPaths.map((dir) =>
          run(AD_HOC_SIGNER, adHocArgs({ app: join(dir, `${APP_NAME}.app`) })),
        ),
      )
    },
  },
}

export default config
