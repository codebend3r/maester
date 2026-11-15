import type { StateStorage } from 'zustand/middleware'

/** The localStorage keys the shared stores keep their state under. */
export const STORE_KEYS = {
  pageBackdrop: 'raven-page-backdrop',
  toasts: 'raven-toasts',
} as const

/**
 * zustand's persist falls back to `window.localStorage` when it has no storage,
 * which the headless entry must not touch and React Native does not have, and it
 * only gains `persist.setOptions` when it starts with one. This holds the place
 * until the store is given its storage (`configureStorage`, or AsyncStorage on a device).
 */
export const UNCONFIGURED_STORAGE: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}
