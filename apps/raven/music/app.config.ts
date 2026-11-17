import { BUILD_ENV, buildNumberOf, isDevelopmentVariant } from '@raven/native/headless'
import type { ConfigContext, ExpoConfig } from 'expo/config'

import packageJson from '#package'
/*
 * Expo loads this file with its own require hook, which reads no tsconfig
 * `paths`, and Node's resolver adds no `.ts`, so the modules it shares with
 * the app come in by their relative path and extension.
 */
import { BRAND, COLORS, FONT_FILES } from './src/theme/wrenTokens.ts'
import { withAndroidAuto } from './plugins/withAndroidAuto.ts'
import { CARPLAY_FLAG, withCarPlay } from './plugins/withCarPlay.ts'
import { withCleartextTraffic } from './plugins/withCleartextTraffic.ts'

const APP_ID = 'app.netlify.wren'

/** The app icon files, rendered at 1024 px from the brand's SVGs in `assets/brand`. */
export const WREN_ICONS = {
  app: './assets/images/icon.png',
  adaptive: './assets/images/adaptive-icon.png',
  monochrome: './assets/images/adaptive-icon-monochrome.png',
} as const

const buildNumber = buildNumberOf({ runNumber: process.env[BUILD_ENV.runNumber] })
const isDevelopment = isDevelopmentVariant({ variant: process.env[BUILD_ENV.appVariant] })
const isCarPlay = process.env[CARPLAY_FLAG.name] === CARPLAY_FLAG.on

const LOCAL_NETWORK_USE = 'Wren reaches your raven server on your local network.'

export default ({ config }: ConfigContext): ExpoConfig => {
  const base: ExpoConfig = {
    ...config,
    // What the home screen writes under the icon, and the name of the Xcode project.
    name: 'Wren',
    slug: 'wren',
    scheme: 'wren',
    version: packageJson.version,
    orientation: 'default',
    /*
     * Wren follows the system's light or dark unless Settings' Appearance keeps one. Android
     * reads this through expo-system-ui.
     */
    userInterfaceStyle: 'automatic',
    // The brand's files and when each is used: assets/brand/README.md.
    icon: WREN_ICONS.app,
    ios: {
      bundleIdentifier: APP_ID,
      buildNumber: String(buildNumber),
      supportsTablet: true,
      infoPlist: {
        NSLocalNetworkUsageDescription: LOCAL_NETWORK_USE,
        // Music goes on playing with the screen locked or another app in front.
        UIBackgroundModes: ['audio'],
        /*
         * Expo's template allows local networking in every build, so the whole dictionary is
         * written here: a LAN server without TLS is for development, and a release keeps ATS.
         */
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
      /*
       * The mark sits inside the middle two thirds, which every launcher's mask leaves whole;
       * the monochrome layer is what Android 13's themed icons tint.
       */
      adaptiveIcon: {
        foregroundImage: WREN_ICONS.adaptive,
        monochromeImage: WREN_ICONS.monochrome,
        // The icon's ground is the brand's Night, the colour its foreground was drawn on.
        backgroundColor: BRAND.night,
      },
      /*
       * The window's own colour, under the app. iOS reads its counterpart only through
       * expo-system-ui; there the splash covers the window until Wren draws.
       */
      backgroundColor: COLORS.dark.bg,
    },
    plugins: [
      'expo-router',
      // What the system draws before Wren's first frame, in the system's own light or dark.
      [
        'expo-splash-screen',
        { backgroundColor: COLORS.light.bg, dark: { backgroundColor: COLORS.dark.bg } },
      ],
      /*
       * Young Serif and Instrument Sans, embedded in both native projects, so they are there at
       * the first frame. Each file is named by its face's PostScript name, which is the family
       * on iOS and Android alike.
       */
      ['expo-font', { fonts: FONT_FILES }],
    ],
  }
  /*
   * CarPlay and Android Auto browse and play through `@raven/audio`'s browse bridge. CarPlay's
   * entitlement waits for Apple's grant, so a build declares it only when asked to.
   */
  const app = withAndroidAuto(isCarPlay ? withCarPlay(base) : base)
  return isDevelopment ? withCleartextTraffic(app) : app
}
