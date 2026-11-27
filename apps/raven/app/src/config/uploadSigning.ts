/**
 * The Gradle properties the Play upload key is passed in by, as `scripts/play_bundle.sh` sets
 * them (`ORG_GRADLE_PROJECT_<name>` in the environment, so no secret is on a command line). The
 * one password opens both the PKCS12 store and the key inside it.
 */
export const UPLOAD_KEY_PROPERTIES = {
  storeFile: 'RAVEN_UPLOAD_STORE_FILE',
  password: 'RAVEN_UPLOAD_PASSWORD',
  keyAlias: 'RAVEN_UPLOAD_KEY_ALIAS',
} as const

// Expo's template opens its signing configs here and signs the release with the debug key here.
const SIGNING_CONFIGS_OPEN = 'signingConfigs {\n'
const RELEASE_DEBUG_SIGNING = /(release \{[^}]*?)signingConfig signingConfigs\.debug/

const { storeFile, password, keyAlias } = UPLOAD_KEY_PROPERTIES

const UPLOAD_SIGNING_CONFIG = `        upload {
            if (findProperty('${storeFile}')) {
                storeFile file(findProperty('${storeFile}'))
                storePassword findProperty('${password}')
                keyAlias findProperty('${keyAlias}')
                keyPassword findProperty('${password}')
            }
        }
`

const RELEASE_SIGNING = `signingConfig findProperty('${storeFile}') ? signingConfigs.upload : signingConfigs.debug`

type WithUploadSigningProps = { gradle: string }

/**
 * The app's `build.gradle` with the release signed by the upload key whenever its store is
 * passed, and by the debug key otherwise, as the sideloaded APKs and the e2e builds always were.
 * It throws on a template it cannot place the change in, so a changed template never ships a
 * Play bundle signed with the debug key unnoticed.
 */
export const withUploadSigningOf = ({ gradle }: WithUploadSigningProps): string => {
  if (gradle.includes(UPLOAD_SIGNING_CONFIG)) return gradle
  if (!gradle.includes(SIGNING_CONFIGS_OPEN) || !RELEASE_DEBUG_SIGNING.test(gradle)) {
    throw new Error('build.gradle has no signingConfigs block or release debug signing to replace')
  }
  return gradle
    .replace(SIGNING_CONFIGS_OPEN, `${SIGNING_CONFIGS_OPEN}${UPLOAD_SIGNING_CONFIG}`)
    .replace(RELEASE_DEBUG_SIGNING, `$1${RELEASE_SIGNING}`)
}
