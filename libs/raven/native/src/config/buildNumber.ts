/** What each app's `app.config.ts` reads from the environment at prebuild. */
export const BUILD_ENV = {
  runNumber: 'GITHUB_RUN_NUMBER',
  appVariant: 'APP_VARIANT',
  /** The Apple team that signs a device build, written into the Xcode project so no one picks it in Xcode. */
  appleTeamId: 'APPLE_TEAM_ID',
} as const

type BuildNumberOfProps = { runNumber: string | undefined }

/**
 * Apple's CFBundleVersion and Android's versionCode both want a positive whole
 * number. A local build has no run number and counts as the first.
 */
export const buildNumberOf = ({ runNumber }: BuildNumberOfProps): number => {
  const trimmed = runNumber?.trim() ?? ''
  if (!/^[1-9]\d*$/.test(trimmed)) return 1
  return Number(trimmed)
}
