import * as SecureStore from 'expo-secure-store'

import type { SecretStore } from '@/servers/secretStore'

/** The keychain on Apple, which tvOS keeps as well, and the keystore on Android. */
export const secretStore: SecretStore = SecureStore
