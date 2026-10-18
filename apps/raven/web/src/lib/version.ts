import { version } from '#package'

/**
 * The version raven shows. CI bakes the build after each merge into main in
 * (`X.Y.Z.N`, the Nth build of `X.Y.Z`); package.json holds only `X.Y.Z`,
 * since four numbers are not semver. Netlify's production build reads the tag
 * or calculates CI's build number (apps/raven/netlify-build.sh). Anything else,
 * unset in development, a pull request's image or a deploy preview, or a build of some
 * other version, gives package.json's own.
 */
export const releaseVersion = ({
  built = '',
  packageVersion,
}: {
  built: string | undefined
  packageVersion: string
}) =>
  built.startsWith(`${packageVersion}.`) &&
  /^[1-9][0-9]*$/.test(built.slice(packageVersion.length + 1))
    ? built
    : packageVersion

export const ravenVersion = releaseVersion({
  built: import.meta.env.VITE_RAVEN_VERSION,
  packageVersion: version,
})
