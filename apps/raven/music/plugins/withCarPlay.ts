import { type ConfigPlugin, withEntitlementsPlist, withInfoPlist } from 'expo/config-plugins'

/** Apple grants it on request; until then CarPlay shows Wren in the simulator alone. */
const CARPLAY_ENTITLEMENT = 'com.apple.developer.carplay-audio'

/**
 * Every scene Wren declares. Expo 58's template declares the window's alone, and a manifest is
 * written whole, so the window's is restated as the template has it, beside CarPlay's, whose
 * delegate is `@raven/audio`'s `RavenCarPlay`, named with its pod's module.
 */
const sceneManifest = () => ({
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
      },
    ],
    CPTemplateApplicationSceneSessionRoleApplication: [
      {
        UISceneClassName: 'CPTemplateApplicationScene',
        UISceneConfigurationName: 'CarPlay',
        UISceneDelegateClassName: 'RavenAudio.RavenCarPlay',
      },
    ],
  },
})

/** Wren in CarPlay: the audio entitlement, and the CarPlay scene beside the window's. */
export const withCarPlay: ConfigPlugin = (config) =>
  withInfoPlist(
    withEntitlementsPlist(config, (mod) => ({
      ...mod,
      modResults: { ...mod.modResults, [CARPLAY_ENTITLEMENT]: true },
    })),
    (mod) => ({
      ...mod,
      modResults: {
        ...mod.modResults,
        UIApplicationSceneManifest: sceneManifest(),
      },
    }),
  )
