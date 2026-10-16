import { resolve } from 'node:path'

export const moltenvkBuildCommands = ({
  source,
  buildRoot,
}: {
  source: string
  buildRoot: string
}) => {
  // Upstream packaging removes External/build/Intermediates while Xcode is still running.
  const derivedData = resolve(buildRoot, 'xcode-derived-data')
  return [
    {
      cwd: source,
      args: [
        'xcodebuild',
        'build',
        '-quiet',
        '-project',
        'ExternalDependencies.xcodeproj',
        '-scheme',
        'ExternalDependencies-macOS',
        '-configuration',
        'Release',
        '-destination',
        'generic/platform=macOS',
        '-derivedDataPath',
        resolve(derivedData, 'moltenvk-external'),
        'ARCHS=arm64',
        'ONLY_ACTIVE_ARCH=YES',
        'CODE_SIGNING_ALLOWED=NO',
      ],
    },
    {
      cwd: source,
      args: [
        'xcodebuild',
        'build',
        '-quiet',
        '-project',
        'MoltenVKPackaging.xcodeproj',
        '-scheme',
        'MoltenVK Package (macOS only)',
        '-configuration',
        'Release',
        '-destination',
        'generic/platform=macOS',
        '-derivedDataPath',
        resolve(derivedData, 'moltenvk-package'),
        'ARCHS=arm64',
        'ONLY_ACTIVE_ARCH=YES',
        'CODE_SIGNING_ALLOWED=NO',
      ],
    },
  ]
}
