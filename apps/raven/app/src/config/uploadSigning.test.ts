import { describe, expect, it } from 'bun:test'

import { UPLOAD_KEY_PROPERTIES, withUploadSigningOf } from '@/config/uploadSigning'

// The part of Expo 58's template `build.gradle` the change touches, as a prebuild writes it.
const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`

describe('withUploadSigningOf', () => {
  it('adds the upload key and signs the release with it when its store is passed', () => {
    const gradle = withUploadSigningOf({ gradle: TEMPLATE })
    expect(gradle).toContain(`storeFile file(findProperty('${UPLOAD_KEY_PROPERTIES.storeFile}'))`)
    expect(gradle).toContain(
      `signingConfig findProperty('${UPLOAD_KEY_PROPERTIES.storeFile}') ? signingConfigs.upload : signingConfigs.debug`,
    )
  })

  it('leaves the debug build signed with the debug key', () => {
    const gradle = withUploadSigningOf({ gradle: TEMPLATE })
    expect(gradle).toContain('debug {\n            signingConfig signingConfigs.debug\n        }')
  })

  it('changes nothing the second time', () => {
    const once = withUploadSigningOf({ gradle: TEMPLATE })
    expect(withUploadSigningOf({ gradle: once })).toBe(once)
  })

  it('throws on a template whose release it cannot find', () => {
    const changed = TEMPLATE.replace('release {', 'production {')
    expect(() => withUploadSigningOf({ gradle: changed })).toThrow()
  })
})
