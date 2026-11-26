import { AUDIO_PLATFORMS, type AudioPlatform } from '@raven/core'

/** What React Native's `Platform.OS` reports on the TVs Wren is built for. */
export const SYSTEMS = { ios: 'ios', android: 'android' } as const

type AudioPlatformOfProps = { os: string }

/**
 * Whose player decodes a track on this TV: AVPlayer on Apple TV, which reports `ios`, and
 * ExoPlayer on Android TV. Passed the OS, so it is testable without React Native.
 */
export const audioPlatformOf = ({ os }: AudioPlatformOfProps): AudioPlatform => {
  if (os === SYSTEMS.ios) return AUDIO_PLATFORMS.apple
  if (os === SYSTEMS.android) return AUDIO_PLATFORMS.android
  throw new Error(`Wren on TV is not built for ${os}`)
}
