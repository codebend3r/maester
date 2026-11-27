/**
 * What reaches the device itself: the keychain, React Native's app state and event stream, and
 * NetInfo, react-native-svg, `@raven/audio`'s player and `react-native-video`. What runs anywhere, bun's tests included, is in `headless.ts`.
 */
export {
  type AccountSessionStore,
  accessTokenNow,
  createAccountSession,
} from '@/account/accountSession'
export { DISK_TRANSFERS, deviceDiskFor } from '@/downloads/deviceDisk'
export { secretStore } from '@/servers/deviceSecretStore'
export { isOnCellular, watchNetwork } from '@/servers/networkChanges'
export {
  type ApiForProps,
  apiFor,
  cookieJar,
  openEventsFor,
  openFetch,
} from '@/servers/serverClient'
export { followAccountServers } from '@/servers/followAccountServers'
export { useServerUnlock } from '@/servers/serverUnlock'
export { Icon } from '@/icons/Icon'
export { DEVICE_AUDIO_PLATFORM, useNativeAudioHost } from '@/music/useNativeAudioHost'
export {
  VideoAudioHost,
  type VideoTrackSource,
  type VideoTrackSourceOf,
} from '@/music/VideoAudioHost'
export { watchAppHide } from '@/player/watchAppHide'
