import { releaseVersion } from '@raven/core'
import { version } from '#package'

/** The version Wren shows: the build its tag names, else package.json's. */
export const wrenVersion = releaseVersion({
  built: import.meta.env.VITE_RAVEN_VERSION,
  packageVersion: version,
})
