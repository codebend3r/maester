import { fileURLToPath } from 'node:url'

export const PLATFORMS = {
  darwin: 'darwin',
  win32: 'win32',
} as const satisfies Record<string, NodeJS.Platform>
export const ARCHITECTURES = {
  arm64: 'arm64',
  x64: 'x64',
} as const satisfies Record<string, NodeJS.Architecture>

/** The native builds raven ships, named as their `resources/<target>` folder. */
export const NATIVE_TARGETS = { darwinArm64: 'darwin-arm64', win32X64: 'win32-x64' } as const

export type NativeTarget = (typeof NATIVE_TARGETS)[keyof typeof NATIVE_TARGETS]

type NativeTargetOfProps = {
  platform: NodeJS.Platform
  arch: NodeJS.Architecture
}

/** The target this process can load, or null on a platform raven has no build for. */
export const nativeTargetOf = ({ platform, arch }: NativeTargetOfProps): NativeTarget | null => {
  if (platform === PLATFORMS.darwin && arch === ARCHITECTURES.arm64)
    return NATIVE_TARGETS.darwinArm64
  if (platform === PLATFORMS.win32 && arch === ARCHITECTURES.x64) return NATIVE_TARGETS.win32X64
  return null
}

const ADDON_FILE = 'raven_mpv.node'

/** The addon built in this checkout for the running process; throws where raven has no build. */
export const localAddonPath = (): string => {
  const target = nativeTargetOf({ platform: process.platform, arch: process.arch })
  if (target === null) throw new Error(`No raven mpv build for ${process.platform} ${process.arch}`)
  return fileURLToPath(new URL(`../resources/${target}/${ADDON_FILE}`, import.meta.url))
}
