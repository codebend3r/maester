import { describe, expect, it } from 'bun:test'

import { withCarMetaData } from '#plugins/withAndroidAuto'
import { carPlayInfoPlist } from '#plugins/withCarPlay'

const CAR_PLAY_ROLE = 'CPTemplateApplicationSceneSessionRoleApplication'

const WINDOW_ROLE = 'UIWindowSceneSessionRoleApplication'

const CAR_APPLICATION = 'com.google.android.gms.car.application'

const EXPO_WINDOW = [
  {
    UISceneConfigurationName: 'Default Configuration',
    UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
  },
]

const CAR_PLAY_SCENE = [
  {
    UISceneClassName: 'CPTemplateApplicationScene',
    UISceneConfigurationName: 'CarPlay',
    UISceneDelegateClassName: 'RavenAudio.RavenCarPlay',
  },
]

describe('carPlayInfoPlist', () => {
  it("keeps the window's scene Expo declares and adds CarPlay's role", () => {
    const plist = carPlayInfoPlist({
      CFBundleName: 'Wren',
      UIApplicationSceneManifest: {
        UIApplicationSupportsMultipleScenes: true,
        UISceneConfigurations: { [WINDOW_ROLE]: EXPO_WINDOW },
      },
    })
    expect(plist).toEqual({
      CFBundleName: 'Wren',
      UIApplicationSceneManifest: {
        UIApplicationSupportsMultipleScenes: true,
        UISceneConfigurations: { [WINDOW_ROLE]: EXPO_WINDOW, [CAR_PLAY_ROLE]: CAR_PLAY_SCENE },
      },
    })
  })

  it("gives a plist with no manifest the window's scene and CarPlay's", () => {
    expect(carPlayInfoPlist({})).toEqual({
      UIApplicationSceneManifest: {
        UIApplicationSupportsMultipleScenes: false,
        UISceneConfigurations: { [WINDOW_ROLE]: EXPO_WINDOW, [CAR_PLAY_ROLE]: CAR_PLAY_SCENE },
      },
    })
  })
})

describe('withCarMetaData', () => {
  it('holds the car meta-data once, keeping the rest', () => {
    const other = {
      $: { 'android:name': 'expo.modules.updates.ENABLED', 'android:value': 'false' },
    }
    const stale = { $: { 'android:name': CAR_APPLICATION, 'android:resource': '@xml/old' } }
    const application = withCarMetaData({
      $: { 'android:name': '.MainApplication' },
      'meta-data': [other, stale],
    })
    expect(application['meta-data']).toEqual([
      other,
      { $: { 'android:name': CAR_APPLICATION, 'android:resource': '@xml/automotive_app_desc' } },
    ])
  })
})
