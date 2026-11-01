import type { StateStorage } from 'zustand/middleware'

/** The localStorage keys the shared stores keep their state under. */
export const STORE_KEYS = {
  mediaOrigin: 'raven-media-origin',
  pageBackdrop: 'raven-page-backdrop',
  playerServices: 'raven-player-services',
  toasts: 'raven-toasts',
} as const

/**
 * zustand's persist falls back to `window.localStorage` when it has no storage,
 * which the headless entry must not touch, and it only gains `persist.setOptions`
 * when it starts with one. This holds the place until `configureStorage`.
 */
export const UNCONFIGURED_STORAGE: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}
