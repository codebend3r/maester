import { type ConfigPlugin, withAppBuildGradle } from 'expo/config-plugins'

import { withUploadSigningOf } from '../src/config/uploadSigning.ts'

/**
 * Signs the Android release with the Play upload key when `scripts/play_bundle.sh` passes it, on
 * a phone or a TV prebuild alike; every other release build keeps the debug key it always had.
 */
export const withUploadSigning: ConfigPlugin = (config) =>
  withAppBuildGradle(config, (mod) => ({
    ...mod,
    modResults: {
      ...mod.modResults,
      contents: withUploadSigningOf({ gradle: mod.modResults.contents }),
    },
  }))
