type ReleaseVersionProps = {
  built: string | undefined
  packageVersion: string
}

/**
 * The version an app shows. CI tags the build after each merge into main `vX.Y.Z.N`, the Nth
 * build of `X.Y.Z`; package.json holds only `X.Y.Z`, since four numbers are not semver. A build
 * of this version (`built`, which the app's build reads from the tag) is shown whole; anything
 * else, none at all, a build of some other version or a malformed one, gives package.json's own.
 */
export const releaseVersion = ({ built = '', packageVersion }: ReleaseVersionProps): string =>
  built.startsWith(`${packageVersion}.`) &&
  /^[1-9][0-9]*$/.test(built.slice(packageVersion.length + 1))
    ? built
    : packageVersion
