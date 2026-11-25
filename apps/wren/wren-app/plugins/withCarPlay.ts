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
  windowRole: 'UIWindowSceneSessionRoleApplication',
  multipleScenes: 'UIApplicationSupportsMultipleScenes',
  className: 'UISceneClassName',
  configurationName: 'UISceneConfigurationName',
  delegateClassName: 'UISceneDelegateClassName',
} as const

const SCENES = {
  carPlay: {
    className: 'CPTemplateApplicationScene',
    configurationName: 'CarPlay',
    delegateClassName: 'RavenAudio.RavenCarPlay',
  },
  window: {
    configurationName: 'Default Configuration',
    delegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
  },
} as const

/** CarPlay's scene: its delegate is `@raven/audio`'s `RavenCarPlay`, named with its pod's module. */
const carPlayScenes = () => [
  {
    [SCENE_KEYS.className]: SCENES.carPlay.className,
    [SCENE_KEYS.configurationName]: SCENES.carPlay.configurationName,
    [SCENE_KEYS.delegateClassName]: SCENES.carPlay.delegateClassName,
  },
]

/*
 * The window's scene as Expo 58's template declares it, for a manifest that has none, since a
 * manifest with CarPlay's role alone would leave the app no window.
 */
const windowScenes = () => [
  {
    [SCENE_KEYS.configurationName]: SCENES.window.configurationName,
    [SCENE_KEYS.delegateClassName]: SCENES.window.delegateClassName,
  },
]

type PlistValue = IOSConfig.InfoPlist[string]

const isPlistDictionary = (value: PlistValue): value is Record<string, PlistValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type InfoPlist = IOSConfig.InfoPlist

/** The Info.plist with CarPlay's scene added to the manifest's, the window's scene kept. */
export const carPlayInfoPlist = (plist: InfoPlist): InfoPlist => {
  const manifest = plist[SCENE_KEYS.manifest]
  const declared = isPlistDictionary(manifest) ? manifest : null
  const configurations = declared?.[SCENE_KEYS.configurations] ?? null
  const scenes = isPlistDictionary(configurations)
    ? configurations
    : { [SCENE_KEYS.windowRole]: windowScenes() }
  return {
    ...plist,
    [SCENE_KEYS.manifest]: {
      [SCENE_KEYS.multipleScenes]: false,
      ...declared,
      [SCENE_KEYS.configurations]: { ...scenes, [SCENE_KEYS.carPlayRole]: carPlayScenes() },
    },
  }
}

/** Wren in CarPlay: the audio entitlement, and CarPlay's scene added to the manifest's. */
export const withCarPlay: ConfigPlugin = (config) =>
  withInfoPlist(
    withEntitlementsPlist(config, (mod) => ({
      ...mod,
      modResults: { ...mod.modResults, [CARPLAY_ENTITLEMENT]: true },
    })),
    (mod) => ({ ...mod, modResults: carPlayInfoPlist(mod.modResults) }),
  )
