import type { SecretStore } from '@/servers/secretStore'

/** A secure store over a map, which records its reads. */
export const memoryStore = (entries: [string, string][] = []) => {
  const items = new Map(entries)
  const reads: string[] = []
  const store: SecretStore = {
    getItemAsync: async (key) => {
      reads.push(key)
      return items.get(key) ?? null
    },
    setItemAsync: async (key, value) => {
      items.set(key, value)
    },
    deleteItemAsync: async (key) => {
      items.delete(key)
    },
  }
  return { store, items, reads }
}

const MISSING_ENTITLEMENT = 'A required entitlement is not present.'

/** A store that fails every call, as the keychain does for a simulator build with no signature. */
export const failingStore: SecretStore = {
  getItemAsync: async () => {
    throw new Error(MISSING_ENTITLEMENT)
  },
  setItemAsync: async () => {
    throw new Error(MISSING_ENTITLEMENT)
  },
  deleteItemAsync: async () => {
    throw new Error(MISSING_ENTITLEMENT)
  },
}
