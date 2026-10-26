import type { StateStorage } from 'zustand/middleware'

/** The calls the app makes on `expo-secure-store`, so a test hands it a map instead. */
export type SecretStore = {
  getItemAsync: (key: string) => Promise<string | null>
  setItemAsync: (key: string, value: string) => Promise<void>
  deleteItemAsync: (key: string) => Promise<void>
}

type SettleProps<T> = {
  work: Promise<T>
  fallback: T
}

/**
 * The store's answer, or `fallback` when it fails. A keychain the build has no entitlement
 * for costs only what would have outlived this run; the app keeps working without it.
 */
export const settle = async <T>({ work, fallback }: SettleProps<T>): Promise<T> => {
  try {
    return await work
  } catch {
    return fallback
  }
}

type SecretStateStorageProps = { store: SecretStore }

/** A zustand storage over the secure store, which degrades rather than fails as `settle` does. */
export const secretStateStorage = ({ store }: SecretStateStorageProps): StateStorage => ({
  getItem: (name) => settle({ work: store.getItemAsync(name), fallback: null }),
  setItem: (name, value) => settle({ work: store.setItemAsync(name, value), fallback: undefined }),
  removeItem: (name) => settle({ work: store.deleteItemAsync(name), fallback: undefined }),
})
