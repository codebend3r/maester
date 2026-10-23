const memory = new Map<string, string>()

const memoryStorage: Storage = {
  get length() {
    return memory.size
  },
  clear: () => memory.clear(),
  getItem: (key) => memory.get(key) ?? null,
  key: (index) => [...memory.keys()][index] ?? null,
  removeItem: (key) => void memory.delete(key),
  setItem: (key, value) => void memory.set(key, value),
}

/** Reading `window.localStorage` itself throws in some private or locked-down windows. */
export const localOrMemoryStorage = (): Storage => {
  try {
    return window.localStorage
  } catch {
    return memoryStorage
  }
}
