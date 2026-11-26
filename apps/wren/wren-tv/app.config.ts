import { BUILD_ENV, buildNumberOf, isDevelopmentVariant } from '@raven/native/headless'
import { BRAND, WREN_PALETTES } from '@raven/wren'
import type { ConfigContext, ExpoConfig } from 'expo/config'

import packageJson from '#package'
/*
 * Expo loads this file with its own require hook, which reads no tsconfig
 * `paths`, and Node's resolver adds no `.ts`, so the modules it shares with
 * the app come in by their relative path and extension.
 */
import { FONT_FILES } from './src/theme/tvFonts.ts'
import { WREN_TV_SCHEME } from './src/config/linkScheme.ts'
import { BUILD_EXTRA } from './src/about/buildExtra.ts'
import { latestVersionTag } from '../../../tooling/web/versionTag.ts'
/*
 * raven's TV plugins and the phone's cleartext plugin, by path: the remote's test target named
 * for Wren, the Top Shelf extension, and the Android TV manifest without the phone's music service.
 */
import { withCleartextTraffic } from '../wren-app/plugins/withCleartextTraffic.ts'
import { withTvRemoteTests } from '../../raven/app/plugins/withTvRemoteTests.ts'
import { withTvTopShelf } from '../../raven/app/plugins/withTvTopShelf.ts'
import { withoutTvAudioService } from '../../raven/app/plugins/withoutTvAudioService.ts'

/** Wren on TV's own id, so it installs beside raven's TV app and beside the phone's Wren. */
export const WREN_TV_ID = 'app.netlify.wren.tv'

/** Where `scripts/tv_images.sh` draws the launcher pictures. */
const IMAGES = './assets/images'

const APPLE_TV_IMAGES = `${IMAGES}/tv_apple`

type AppleTVIconLayers = { front: string; back: string }

type AppleTVIconLayersProps = { name: string }

/** One Apple TV icon size as its two layers: the bird in front, the Leaf behind. */
const appleTVIconLayersOf = ({ name }: AppleTVIconLayersProps): AppleTVIconLayers => ({
  front: `${APPLE_TV_IMAGES}/${name}-front.png`,
  back: `${APPLE_TV_IMAGES}/${name}-back.png`,
})

/** The launcher pictures, drawn by `scripts/tv_images.sh` from the brand's SVGs. */
export const WREN_TV_IMAGES = {
  icon: `${IMAGES}/icon.png`,
  banner: `${IMAGES}/tv_banner.png`,
  apple: {
    iconSmallLayers: appleTVIconLayersOf({ name: 'icon-small' }),
    iconSmall2xLayers: appleTVIconLayersOf({ name: 'icon-small-2x' }),
    iconLayers: appleTVIconLayersOf({ name: 'icon-large' }),
    topShelf: `${APPLE_TV_IMAGES}/top-shelf.png`,
    topShelf2x: `${APPLE_TV_IMAGES}/top-shelf-2x.png`,
    topShelfWide: `${APPLE_TV_IMAGES}/top-shelf-wide.png`,
    topShelfWide2x: `${APPLE_TV_IMAGES}/top-shelf-wide-2x.png`,
  },
  // The signed out Top Shelf's invitation, which `withTvTopShelf` copies into the extension.
  signIn: {
    picture: `${APPLE_TV_IMAGES}/top-shelf-sign-in.png`,
    picture2x: `${APPLE_TV_IMAGES}/top-shelf-sign-in-2x.png`,
  },
} as const

const buildNumber = buildNumberOf({ runNumber: process.env[BUILD_ENV.runNumber] })
const isDevelopment = isDevelopmentVariant({ variant: process.env[BUILD_ENV.appVariant] })
// The team a device build is signed under; with none written, Xcode asks on every prebuild.
const appleTeamId = process.env[BUILD_ENV.appleTeamId]?.trim() ?? ''

/** The Siri Remote's UI test target `tvos-e2e/` compiles into; its bundle is the app's id with `.remote-tests`. */
const REMOTE_TESTS = { target: 'WrenRemoteTests' } as const

const LOCAL_NETWORK_USE = 'Wren reaches your raven server on your local network.'

export default ({ config }: ConfigContext): ExpoConfig => {
  const app: ExpoConfig = {
    ...config,
    // What the TV's launcher writes under the icon, and the name of the Xcode project.
    name: 'Wren',
    slug: 'wren-tv',
    scheme: WREN_TV_SCHEME,
    version: packageJson.version,
    // The build Settings shows, `0.9.0.15`, where the store version stays package.json's.
    extra: { ...config.extra, [BUILD_EXTRA.releaseVersion]: latestVersionTag() },
    orientation: 'landscape',
    // Wren follows the system's light or dark unless Settings' Appearance keeps one.
    userInterfaceStyle: 'automatic',
    icon: WREN_TV_IMAGES.icon,
    ios: {
      bundleIdentifier: WREN_TV_ID,
      buildNumber: String(buildNumber),
      ...(appleTeamId === '' ? {} : { appleTeamId }),
      infoPlist: {
        NSLocalNetworkUsageDescription: LOCAL_NETWORK_USE,
        // Wren's only encryption is the system's HTTPS, which is exempt.
        ITSAppUsesNonExemptEncryption: false,
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
      package: WREN_TV_ID,
      versionCode: buildNumber,
      // The window's own colour, under the app, Night's ground.
      backgroundColor: WREN_PALETTES.night.bg,
    },
    plugins: [
      'expo-router',
      /*
       * Every build of this app is a TV build, so config-tv is on whatever `EXPO_TV` says: the
       * Android TV launcher's banner and the Apple TV's layered icon and Top Shelf images.
       */
      [
        '@react-native-tvos/config-tv',
        {
          isTV: true,
          androidTVBanner: WREN_TV_IMAGES.banner,
          appleTVImages: WREN_TV_IMAGES.apple,
        },
      ],
      // Music plays through the video player out of sight; it needs no picture in picture.
      ['react-native-video', { enableBackgroundAudio: true, enableAndroidPictureInPicture: false }],
      // What the system draws before Wren's first frame: the brand's Leaf, as its icon wears.
      ['expo-splash-screen', { backgroundColor: BRAND.leaf }],
      // Young Serif and Instrument Sans, the phone app's own files, named by their PostScript name.
      ['expo-font', { fonts: FONT_FILES }],
    ],
  }
  /*
   * The remote-driven test and the Top Shelf extension join the Apple TV's project; Android TV
   * drops the phone's music service.
   */
  const withTv = withoutTvAudioService(
    withTvTopShelf(withTvRemoteTests(app, REMOTE_TESTS), { signIn: WREN_TV_IMAGES.signIn }),
  )
  return isDevelopment ? withCleartextTraffic(withTv) : withTv
}
