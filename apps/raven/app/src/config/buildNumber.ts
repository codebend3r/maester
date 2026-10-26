export const BUILD_ENV = {
  runNumber: 'GITHUB_RUN_NUMBER',
  appVariant: 'APP_VARIANT',
  tv: 'EXPO_TV',
} as const

type BuildNumberOfProps = { runNumber: string | undefined }

// Apple's CFBundleVersion and Android's versionCode both want a positive whole
// number. A local build has no run number and counts as the first.
export const buildNumberOf = ({ runNumber }: BuildNumberOfProps): number => {
  const trimmed = runNumber?.trim() ?? ''
  if (!/^[1-9]\d*$/.test(trimmed)) return 1
  return Number(trimmed)
}
