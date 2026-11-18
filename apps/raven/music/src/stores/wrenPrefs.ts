import {
  AUDIO_BITRATES,
  type AudioBitrate,
  isAudioBitrate,
  isRecord,
  nullable,
  oneOf,
} from '@raven/core'
import { loadPersisted } from '@raven/native/headless'
import { UNCONFIGURED_STORAGE } from '@raven/ui/headless'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'

/** The key Wren's preferences are stored under in AsyncStorage. */
export const WREN_PREFS_KEY = 'wren.prefs'

/** The storage limits Settings offers, in gigabytes; null is no limit. */
export const STORAGE_LIMITS_GB = [null, 2, 5, 10, 20] as const

type StorageLimitGb = (typeof STORAGE_LIMITS_GB)[number]

/** How Wren picks its palette: the system's, or always light or dark. */
export const APPEARANCES = { system: 'system', light: 'light', dark: 'dark' } as const

export type Appearance = (typeof APPEARANCES)[keyof typeof APPEARANCES]

const isAppearance = oneOf(Object.values(APPEARANCES))

/** What makes an album recent on Home: when it was added, or when it came out. */
export const RECENT_SORTS = { added: 'added', release: 'release' } as const

export type RecentSort = (typeof RECENT_SORTS)[keyof typeof RECENT_SORTS]

const isRecentSort = oneOf(Object.values(RECENT_SORTS))

const isStorageLimitGb = (value: unknown): value is StorageLimitGb =>
  STORAGE_LIMITS_GB.some((limit) => limit === value)

/** A cellular quality: a transcode's bitrate, or null for the file itself. */
const isCellularKbps = nullable(isAudioBitrate)

/** What this device keeps of the listener's choices. */
type WrenPrefsValues = {
  /** The bitrate a download is transcoded to. */
  downloadKbps: AudioBitrate
  /** The bitrate a track streams at on a mobile network; null streams the file itself. */
  cellularKbps: AudioBitrate | null
  /** How much the downloads may take, in gigabytes; null for no limit. */
  storageLimitGb: StorageLimitGb
  /** Whether Wren follows the system's light or dark, or keeps one. */
  appearance: Appearance
  /** The order of Home's albums. */
  homeSort: RecentSort
}

type WrenPrefs = WrenPrefsValues & {
  /** Changes any of the preferences and keeps them on this device. */
  change: (change: Partial<WrenPrefsValues>) => void
}

/**
 * A fresh install: downloads at 256 kbps, the file itself on cellular as on Wi-Fi (the server's
 * remote limit, not the radio, decides a transcode away from home, as it does for raven's
 * videos), no storage limit, and the system's appearance.
 */
export const DEFAULT_WREN_PREFS: WrenPrefsValues = {
  downloadKbps: AUDIO_BITRATES.standard,
  cellularKbps: null,
  storageLimitGb: null,
  appearance: APPEARANCES.system,
  homeSort: RECENT_SORTS.added,
}

/** What was read back, each preference kept only where it is one, the default otherwise. */
const prefsOf = (saved: unknown): WrenPrefsValues => {
  const kept = isRecord(saved) ? saved : {}
  return {
    downloadKbps: isAudioBitrate(kept.downloadKbps)
      ? kept.downloadKbps
      : DEFAULT_WREN_PREFS.downloadKbps,
    cellularKbps: isCellularKbps(kept.cellularKbps)
      ? kept.cellularKbps
      : DEFAULT_WREN_PREFS.cellularKbps,
    storageLimitGb: isStorageLimitGb(kept.storageLimitGb)
      ? kept.storageLimitGb
      : DEFAULT_WREN_PREFS.storageLimitGb,
    appearance: isAppearance(kept.appearance) ? kept.appearance : DEFAULT_WREN_PREFS.appearance,
    homeSort: isRecentSort(kept.homeSort) ? kept.homeSort : DEFAULT_WREN_PREFS.homeSort,
  }
}

/**
 * The version the prefs are kept at. Version 0 defaulted the cellular stream to a 256 kbps
 * transcode, which the server makes whole before it answers, so away from home every track
 * waited on it; 1 moves those installs to the file itself.
 */
const WREN_PREFS_VERSION = 1

/** Prefs read back from an older version, brought to this one. */
const migratedPrefsOf = (saved: unknown, version: number): WrenPrefsValues =>
  version < WREN_PREFS_VERSION
    ? { ...prefsOf(saved), cellularKbps: DEFAULT_WREN_PREFS.cellularKbps }
    : prefsOf(saved)

/** Settings' appearance, download and streaming choices, persisted to AsyncStorage and guarded when read. */
export const useWrenPrefs = create<WrenPrefs>()(
  persist(
    (set) => ({
      ...DEFAULT_WREN_PREFS,
      change: (change) => set(change),
    }),
    {
      name: WREN_PREFS_KEY,
      storage: createJSONStorage(() => UNCONFIGURED_STORAGE),
      skipHydration: true,
      version: WREN_PREFS_VERSION,
      migrate: migratedPrefsOf,
      partialize: ({ downloadKbps, cellularKbps, storageLimitGb, appearance, homeSort }) => ({
        downloadKbps,
        cellularKbps,
        storageLimitGb,
        appearance,
        homeSort,
      }),
      merge: (saved, current) => ({ ...current, ...prefsOf(saved) }),
    },
  ),
)

type ConfigureWrenPrefsProps = { storage: StateStorage }

/** Gives the preferences their storage, AsyncStorage in the app, and reads them back from it. */
export const configureWrenPrefs = async ({ storage }: ConfigureWrenPrefsProps) => {
  await loadPersisted({ store: useWrenPrefs, storage })
}
