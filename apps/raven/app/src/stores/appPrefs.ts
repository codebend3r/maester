import { DEFAULT_THEME, type ThemeId, isBoolean, isRecord, isThemeId, oneOf } from '@raven/core'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'

/** The key the preferences are stored under. */
export const APP_PREFS_KEY = 'raven-app-prefs'

/**
 * The tallest picture the app asks a transcode for away from home, in lines: the web's 4K,
 * 1080p and 720p, as the server's own cap offers them.
 */
export const AWAY_MAX_HEIGHTS = { uhd: 2160, fullHd: 1080, hd: 720 } as const

export type AwayMaxHeight = (typeof AWAY_MAX_HEIGHTS)[keyof typeof AWAY_MAX_HEIGHTS]

export const isAwayMaxHeight = oneOf(Object.values(AWAY_MAX_HEIGHTS))

/** What this device keeps of the viewer's choices, beside the player's own preferences. */
export type AppPrefsValues = {
  theme: ThemeId
  /** Whether a file this device may refuse (a maybe in its table) is tried as it is first. */
  shouldPreferDirectPlay: boolean
  /** Whether the server may re-encode a file for this device; off, it only remuxes. */
  isTranscodeAllowed: boolean
  /** The cap on a transcode played from the server's public origin. */
  awayMaxHeight: AwayMaxHeight
}

type AppPrefs = AppPrefsValues & {
  /** Changes any of the preferences and keeps them on this device. */
  change: (change: Partial<AppPrefsValues>) => void
}

/**
 * Every preference as a fresh install has it: the default theme, the device's maybes tried as
 * they are, transcoding allowed, and a transcode away from home at 1080p, the server's own
 * default cap, which spares a NAS's CPU and a phone's data.
 */
export const DEFAULT_APP_PREFS: AppPrefsValues = {
  theme: DEFAULT_THEME,
  shouldPreferDirectPlay: true,
  isTranscodeAllowed: true,
  awayMaxHeight: AWAY_MAX_HEIGHTS.fullHd,
}

/** What was read back, each preference kept only where it is one, the default otherwise. */
const prefsOf = (saved: unknown): AppPrefsValues => {
  const kept = isRecord(saved) ? saved : {}
  return {
    theme: isThemeId(kept.theme) ? kept.theme : DEFAULT_APP_PREFS.theme,
    shouldPreferDirectPlay: isBoolean(kept.shouldPreferDirectPlay)
      ? kept.shouldPreferDirectPlay
      : DEFAULT_APP_PREFS.shouldPreferDirectPlay,
    isTranscodeAllowed: isBoolean(kept.isTranscodeAllowed)
      ? kept.isTranscodeAllowed
      : DEFAULT_APP_PREFS.isTranscodeAllowed,
    awayMaxHeight: isAwayMaxHeight(kept.awayMaxHeight)
      ? kept.awayMaxHeight
      : DEFAULT_APP_PREFS.awayMaxHeight,
  }
}

/** Holds the place of the storage until `configureAppPrefs`, as the player prefs do. */
const UNCONFIGURED: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}

/**
 * The theme and the playback choices Settings makes, for this device alone, persisted to
 * AsyncStorage and guarded when read. The player narrows the server's policy by them; they
 * never widen it.
 */
export const useAppPrefs = create<AppPrefs>()(
  persist(
    (set) => ({
      ...DEFAULT_APP_PREFS,
      change: (change) => set(change),
    }),
    {
      name: APP_PREFS_KEY,
      storage: createJSONStorage(() => UNCONFIGURED),
      skipHydration: true,
      partialize: ({ theme, shouldPreferDirectPlay, isTranscodeAllowed, awayMaxHeight }) => ({
        theme,
        shouldPreferDirectPlay,
        isTranscodeAllowed,
        awayMaxHeight,
      }),
      merge: (saved, current) => ({ ...current, ...prefsOf(saved) }),
    },
  ),
)

/** Gives the preferences their storage, AsyncStorage in the app, and reads them back from it. */
export const configureAppPrefs = async ({ storage }: { storage: StateStorage }) => {
  useAppPrefs.persist.setOptions({ storage: createJSONStorage(() => storage) })
  await useAppPrefs.persist.rehydrate()
}
