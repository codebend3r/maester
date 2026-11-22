import { releaseVersion } from '@raven/core'
import Constants from 'expo-constants'

import packageJson from '#package'
import { BUILD_EXTRA } from '@/about/buildExtra'

const built: unknown = Constants.expoConfig?.extra?.[BUILD_EXTRA.releaseVersion]

/** The version Wren shows: the build its tag names, else package.json's. */
export const wrenVersion = releaseVersion({
  built: typeof built === 'string' ? built : undefined,
  packageVersion: packageJson.version,
})
