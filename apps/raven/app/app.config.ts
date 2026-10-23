import type { ConfigContext, ExpoConfig } from 'expo/config'
import { type ConfigPlugin, withAndroidManifest } from 'expo/config-plugins'

import packageJson from '#package'
// Expo loads this file with its own require hook, which reads no tsconfig
// `paths`, and Node's resolver adds no `.ts`, so the modules it shares with
// the app come in by their relative path and extension.
import { isDevelopmentVariant } from './src/config/appVariant.ts'
import { BUILD_ENV, buildNumberOf } from './src/config/buildNumber.ts'

const APP_ID = 'io.github.codebend3r.raven.app'

const buildNumber = buildNumberOf({ runNumber: process.env[BUILD_ENV.runNumber] })
const isDevelopment = isDevelopmentVariant({ variant: process.env[BUILD_ENV.appVariant] })

const LOCAL_NETWORK_USE = 'raven reaches your raven server on your local network.'

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
  const app: ExpoConfig = {
    ...config,
    name: 'raven',
    slug: 'raven',
    scheme: 'raven',
    version: packageJson.version,
    orientation: 'default',
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
    },
    // config-tv acts only when EXPO_TV=1, which the TV prebuild scripts set.
    plugins: ['expo-router', '@react-native-tvos/config-tv', 'react-native-video'],
  }
  return isDevelopment ? withCleartextTraffic(app) : app
}
