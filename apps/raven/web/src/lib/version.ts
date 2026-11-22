import { releaseVersion } from '@raven/core'
import { version } from '#package'

/**
 * The version raven shows: the build Netlify's production build reads from the tag or works out
 * (apps/raven/netlify-build.sh), else package.json's, unset in development, a pull request's
 * image or a deploy preview.
 */
export const ravenVersion = releaseVersion({
  built: import.meta.env.VITE_RAVEN_VERSION,
  packageVersion: version,
})
