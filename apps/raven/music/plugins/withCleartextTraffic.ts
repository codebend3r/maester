import { type ConfigPlugin, withAndroidManifest } from 'expo/config-plugins'

/** Lets a development build reach a LAN server over plain http; Expo's config has no field for it. */
export const withCleartextTraffic: ConfigPlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    const { manifest } = mod.modResults
    const [main, ...rest] = manifest.application ?? []
    const application =
      main === undefined
        ? []
        : [{ ...main, $: { ...main.$, 'android:usesCleartextTraffic': 'true' as const } }, ...rest]
    return { ...mod, modResults: { ...mod.modResults, manifest: { ...manifest, application } } }
  })
