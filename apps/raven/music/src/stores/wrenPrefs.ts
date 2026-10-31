import { AUDIO_BITRATES, type AudioBitrate, isAudioBitrate, isRecord } from '@raven/core'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'

/** The key Wren's preferences are stored under in AsyncStorage. */
export const WREN_PREFS_KEY = 'wren.prefs'

/** The storage limits Settings offers, in gigabytes; null is no limit. */
export const STORAGE_LIMITS_GB = [null, 2, 5, 10, 20] as const

type StorageLimitGb = (typeof STORAGE_LIMITS_GB)[number]

const isStorageLimitGb = (value: unknown): value is StorageLimitGb =>
  STORAGE_LIMITS_GB.some((limit) => limit === value)

/** A cellular quality: a transcode's bitrate, or null for the file itself. */
const isCellularKbps = (value: unknown): value is AudioBitrate | null =>
  value === null || isAudioBitrate(value)

/** What this device keeps of the listener's choices. */
type WrenPrefsValues = {
  /** The bitrate a download is transcoded to. */
  downloadKbps: AudioBitrate
  /** The bitrate a track streams at on a mobile network; null streams the file itself. */
  cellularKbps: AudioBitrate | null
  /** How much the downloads may take, in gigabytes; null for no limit. */
  storageLimitGb: StorageLimitGb
}

type WrenPrefs = WrenPrefsValues & {
  /** Changes any of the preferences and keeps them on this device. */
  change: (change: Partial<WrenPrefsValues>) => void
}

/** A fresh install: downloads and the cellular stream at 256 kbps, and no storage limit. */
export const DEFAULT_WREN_PREFS: WrenPrefsValues = {
  downloadKbps: AUDIO_BITRATES.standard,
  cellularKbps: AUDIO_BITRATES.standard,
  storageLimitGb: null,
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
  }
}

/** Holds the place of the storage until `configureWrenPrefs`. */
const UNCONFIGURED: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}

/** Settings' download and streaming choices, persisted to AsyncStorage and guarded when read. */
export const useWrenPrefs = create<WrenPrefs>()(
  persist(
    (set) => ({
      ...DEFAULT_WREN_PREFS,
      change: (change) => set(change),
    }),
    {
      name: WREN_PREFS_KEY,
      storage: createJSONStorage(() => UNCONFIGURED),
      skipHydration: true,
      partialize: ({ downloadKbps, cellularKbps, storageLimitGb }) => ({
        downloadKbps,
        cellularKbps,
        storageLimitGb,
      }),
      merge: (saved, current) => ({ ...current, ...prefsOf(saved) }),
    },
  ),
)

type ConfigureWrenPrefsProps = { storage: StateStorage }

/** Gives the preferences their storage, AsyncStorage in the app, and reads them back from it. */
export const configureWrenPrefs = async ({ storage }: ConfigureWrenPrefsProps) => {
  useWrenPrefs.persist.setOptions({ storage: createJSONStorage(() => storage) })
  await useWrenPrefs.persist.rehydrate()
}
