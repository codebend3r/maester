import { type ConfigPlugin, withAndroidManifest } from 'expo/config-plugins'

const TOOLS_NAMESPACE = 'http://schemas.android.com/tools'

const REMOVE = 'remove'

/** What `@raven/audio`'s own manifest adds that only a phone's music needs. */
const AUDIO_SERVICE = 'expo.modules.ravenaudio.RavenAudioService'
const AUDIO_ARTWORK = 'expo.modules.ravenaudio.RavenArtworkProvider'
const AUDIO_PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
] as const

type Removal = { $: { 'android:name': string; 'tools:node': typeof REMOVE } }

const removalOf = (name: string): Removal => ({
  $: { 'android:name': name, 'tools:node': REMOVE },
})

type WithProviders = { provider: unknown[] }

/** Expo's manifest type names no `provider`, so one a plugin before this added is read through a guard. */
const hasProviders = (application: object): application is WithProviders =>
  'provider' in application && Array.isArray(application.provider)

/**
 * Keeps `@raven/audio`'s media service, its artwork provider and their foreground service
 * permissions out of the Android TV's APK. The module is linked on every Android build, since
 * autolinking has one list for both, but a TV plays music through `react-native-video`, so the
 * manifest merger takes out what the module's own manifest would add.
 */
export const withoutTvAudioService: ConfigPlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    const { manifest } = mod.modResults
    const [main, ...rest] = manifest.application ?? []
    const application =
      main === undefined
        ? []
        : [
            {
              ...main,
              service: [...(main.service ?? []), removalOf(AUDIO_SERVICE)],
              provider: [...(hasProviders(main) ? main.provider : []), removalOf(AUDIO_ARTWORK)],
            },
            ...rest,
          ]
    return {
      ...mod,
      modResults: {
        ...mod.modResults,
        manifest: {
          ...manifest,
          $: { ...manifest.$, 'xmlns:tools': TOOLS_NAMESPACE },
          'uses-permission': [
            ...(manifest['uses-permission'] ?? []),
            ...AUDIO_PERMISSIONS.map(removalOf),
          ],
          application,
        },
      },
    }
  })
