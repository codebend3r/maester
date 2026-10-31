import { DEFAULT_THEME } from '@raven/core'
import { BUILD_ENV, buildNumberOf, isDevelopmentVariant } from '@raven/native/headless'
import { themeTokens } from '@raven/ui/designTokens'
import type { ConfigContext, ExpoConfig } from 'expo/config'

import packageJson from '#package'
// Expo loads this file with its own require hook, which reads no tsconfig
// `paths`, and Node's resolver adds no `.ts`, so the modules it shares with
// the app come in by their relative path and extension.
import { PALETTE_TOKENS } from './src/theme/tokenNames.ts'
import { withAndroidAuto } from './plugins/withAndroidAuto.ts'
import { CARPLAY_FLAG, withCarPlay } from './plugins/withCarPlay.ts'
import { withCleartextTraffic } from './plugins/withCleartextTraffic.ts'

const APP_ID = 'app.netlify.wren'

const buildNumber = buildNumberOf({ runNumber: process.env[BUILD_ENV.runNumber] })
const isDevelopment = isDevelopmentVariant({ variant: process.env[BUILD_ENV.appVariant] })
const isCarPlay = process.env[CARPLAY_FLAG.name] === CARPLAY_FLAG.on

const LOCAL_NETWORK_USE = 'Wren reaches your raven server on your local network.'

/**
 * The default theme's ground, from themes.scss through the built tokens, for what the system
 * draws before Wren's first frame: the splash, and the window behind the app. The system cannot
 * know the theme picked, so it is the default's dark, never a white flash.
 */
const launchGround = (): string => {
  const ground = themeTokens[DEFAULT_THEME]?.[PALETTE_TOKENS.ground] ?? null
  if (ground === null) throw new Error(`themes.scss gives ${DEFAULT_THEME} no ground`)
  return ground
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const ground = launchGround()
  const base: ExpoConfig = {
    ...config,
    // What the home screen writes under the icon, and the name of the Xcode project.
    name: 'Wren',
    slug: 'wren',
    scheme: 'wren',
    version: packageJson.version,
    orientation: 'default',
    ios: {
      bundleIdentifier: APP_ID,
      buildNumber: String(buildNumber),
      supportsTablet: true,
      infoPlist: {
        NSLocalNetworkUsageDescription: LOCAL_NETWORK_USE,
        // Music goes on playing with the screen locked or another app in front.
        UIBackgroundModes: ['audio'],
        // Expo's template allows local networking in every build, so the whole dictionary is
        // written here: a LAN server without TLS is for development, and a release keeps ATS.
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: false,
          NSAllowsLocalNetworking: isDevelopment,
        },
      },
    },
    android: {
      package: APP_ID,
      versionCode: buildNumber,
      // Android 14 starts a media playback foreground service only with this permission.
      permissions: ['android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'],
      // The window's own colour, under the app. iOS reads its counterpart only through
      // expo-system-ui; there the splash covers the window until Wren draws.
      backgroundColor: ground,
    },
    plugins: ['expo-router', ['expo-splash-screen', { backgroundColor: ground }]],
  }
  // CarPlay and Android Auto browse and play through `@raven/audio`'s browse bridge. CarPlay's
  // entitlement waits for Apple's grant, so a build declares it only when asked to.
  const app = withAndroidAuto(isCarPlay ? withCarPlay(base) : base)
  return isDevelopment ? withCleartextTraffic(app) : app
}
