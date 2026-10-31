import {
  type ConfigPlugin,
  type IOSConfig,
  withEntitlementsPlist,
  withInfoPlist,
} from 'expo/config-plugins'

/**
 * The environment variable that builds Wren for CarPlay, and the value that turns it on. Off by
 * default: a profile without Apple's grant cannot sign the entitlement, so Wren signs for a real
 * iPhone until the grant arrives.
 */
export const CARPLAY_FLAG = { name: 'WREN_CARPLAY', on: '1' } as const

/** Apple grants it on request; until then CarPlay shows Wren in the simulator alone. */
const CARPLAY_ENTITLEMENT = 'com.apple.developer.carplay-audio'

const SCENE_KEYS = {
  manifest: 'UIApplicationSceneManifest',
  configurations: 'UISceneConfigurations',
  carPlayRole: 'CPTemplateApplicationSceneSessionRoleApplication',
} as const

/** CarPlay's scene: its delegate is `@raven/audio`'s `RavenCarPlay`, named with its pod's module. */
const carPlayScenes = () => [
  {
    UISceneClassName: 'CPTemplateApplicationScene',
    UISceneConfigurationName: 'CarPlay',
    UISceneDelegateClassName: 'RavenAudio.RavenCarPlay',
  },
]

/**
 * The window's scene as Expo 58's template declares it, for a manifest that has none, since a
 * manifest with CarPlay's role alone would leave the app no window.
 */
const windowScenes = () => [
  {
    UISceneConfigurationName: 'Default Configuration',
    UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
  },
]

type PlistValue = IOSConfig.InfoPlist[string]

const isPlistDictionary = (value: PlistValue): value is Record<string, PlistValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Wren in CarPlay: the audio entitlement, and CarPlay's scene added to the manifest's. */
export const withCarPlay: ConfigPlugin = (config) =>
  withInfoPlist(
    withEntitlementsPlist(config, (mod) => ({
      ...mod,
      modResults: { ...mod.modResults, [CARPLAY_ENTITLEMENT]: true },
    })),
    (mod) => {
      const manifest = mod.modResults[SCENE_KEYS.manifest]
      const declared = isPlistDictionary(manifest) ? manifest : null
      const configurations = declared?.[SCENE_KEYS.configurations] ?? null
      const scenes = isPlistDictionary(configurations)
        ? configurations
        : { UIWindowSceneSessionRoleApplication: windowScenes() }
      return {
        ...mod,
        modResults: {
          ...mod.modResults,
          [SCENE_KEYS.manifest]: {
            UIApplicationSupportsMultipleScenes: false,
            ...declared,
            [SCENE_KEYS.configurations]: { ...scenes, [SCENE_KEYS.carPlayRole]: carPlayScenes() },
          },
        },
      }
    },
  )
