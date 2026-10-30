import { DEFAULT_THEME } from '@raven/core'
import { BUILD_ENV, buildNumberOf, isDevelopmentVariant } from '@raven/native/headless'
import { themeTokens } from '@raven/ui/designTokens'
import type { ConfigContext, ExpoConfig } from 'expo/config'
import { type ConfigPlugin, withAndroidManifest } from 'expo/config-plugins'

import packageJson from '#package'
// Expo loads this file with its own require hook, which reads no tsconfig
// `paths`, and Node's resolver adds no `.ts`, so the modules it shares with
// the app come in by their relative path and extension.
import { TV_ENV, isTvPrebuild } from './src/config/tvPrebuild.ts'
import { PALETTE_TOKENS } from './src/theme/tokenNames.ts'
import { withAndroidFonts } from './plugins/withAndroidFonts.ts'
import { withTvBannerDensities } from './plugins/withTvBannerDensities.ts'
import { withTvRemoteTests } from './plugins/withTvRemoteTests.ts'

const APP_ID = 'io.github.codebend3r.raven.app'

const buildNumber = buildNumberOf({ runNumber: process.env[BUILD_ENV.runNumber] })
const isDevelopment = isDevelopmentVariant({ variant: process.env[BUILD_ENV.appVariant] })
const isTv = isTvPrebuild({ value: process.env[TV_ENV.tv] })

const LOCAL_NETWORK_USE = 'raven reaches your raven server on your local network.'

/**
 * The default theme's ground, from themes.scss through the built tokens the app reads, for what
 * the system draws before raven's first frame: the splash, and the window behind the app. The
 * system cannot know the theme picked, so it is the default's dark, never a white flash.
 */
const launchGround = (): string => {
  const ground = themeTokens[DEFAULT_THEME]?.[PALETTE_TOKENS.ground] ?? null
  if (ground === null) throw new Error(`themes.scss gives ${DEFAULT_THEME} no ground`)
  return ground
}

// Expo's config has no field for it, so the development variant sets it on the manifest.
const withCleartextTraffic: ConfigPlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    const { manifest } = mod.modResults
    const [main, ...rest] = manifest.application ?? []
    const application =
      main === undefined
        ? []
        : [{ ...main, $: { ...main.$, 'android:usesCleartextTraffic': 'true' as const } }, ...rest]
    return { ...mod, modResults: { ...mod.modResults, manifest: { ...manifest, application } } }
  })

export default ({ config }: ConfigContext): ExpoConfig => {
  const ground = launchGround()
  const app: ExpoConfig = {
    ...config,
    // What the home screen and the TV launcher write under the icon.
    name: 'Raven',
    slug: 'raven',
    scheme: 'raven',
    version: packageJson.version,
    orientation: 'default',
    icon: './assets/images/icon.png',
    ios: {
      bundleIdentifier: APP_ID,
      buildNumber: String(buildNumber),
      supportsTablet: true,
      infoPlist: {
        NSLocalNetworkUsageDescription: LOCAL_NETWORK_USE,
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
      // The mark sits inside the middle two thirds, which every launcher's mask leaves whole.
      adaptiveIcon: {
        foregroundImage: './assets/images/adaptive-icon.png',
        backgroundColor: ground,
      },
      // The window's own colour, under the app. iOS reads its counterpart only through
      // expo-system-ui; there the splash covers the window until raven draws.
      backgroundColor: ground,
    },
    plugins: [
      'expo-router',
      // config-tv acts only when EXPO_TV=1, which the TV prebuild scripts set. The banner is the
      // tile the Android TV launcher shows in its apps row: 320 by 180 dp, the mark and the
      // wordmark, drawn by `scripts/tv_banner.sh` at every density (`withTvBannerDensities`).
      ['@react-native-tvos/config-tv', { androidTVBanner: './assets/images/tv_banner.png' }],
      // Picture in Picture needs the audio background mode. The player still pauses when the
      // app leaves the screen without it (`playInBackground` off): this is video.
      ['react-native-video', { enableBackgroundAudio: true }],
      // Held up by `AppRoot` until the stores are read, so the theme picked is the first frame.
      ['expo-splash-screen', { backgroundColor: ground }],
    ],
  }
  // The Apple TV's remote-driven end to end test joins only the TV's native project, and the
  // Android TV's banner at each density only the TV's.
  const withTests = isTv ? withTvRemoteTests(withTvBannerDensities(app)) : app
  const withFonts = withAndroidFonts(withTests)
  return isDevelopment ? withCleartextTraffic(withFonts) : withFonts
}
