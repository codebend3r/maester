import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'

/** The key the prefs are stored under. */
export const PLAYER_PREFS_KEY = 'raven-player'

/** How many seconds the player's controls linger once nothing stirs: the slider's ends and where it starts. */
export const CONTROLS_LINGER_SECONDS = { min: 3, max: 10, initial: 5 } as const

/** A whole number of seconds within the slider's ends. */
const withinLinger = (seconds: number): number =>
  Math.min(CONTROLS_LINGER_SECONDS.max, Math.max(CONTROLS_LINGER_SECONDS.min, Math.round(seconds)))

type PlayerPrefs = {
  volume: number
  muted: boolean
  /** Multiplies the subtitle size; `+` and `-` step it. */
  captionScale: number
  /** Whether subtitles were last on, and in which language. */
  subtitles: { on: boolean; language: string | null }
  /** The audio language last picked by hand; null while the file's default has been fine. */
  audioLanguage: string | null
  /** Whether this browser offers "Open in Raven"; off, since a page cannot tell the app is installed. */
  opensInRavenPlayer: boolean
  /** How many seconds the controls and cursor linger after the last mouse move, key press or click. */
  controlsLingerSeconds: number
  /** Whether what is up next starts by itself once the video ends. */
  autoplay: boolean
  setVolume: ({ volume, muted }: { volume: number; muted: boolean }) => void
  setCaptionScale: (captionScale: number) => void
  setSubtitles: (subtitles: { on: boolean; language: string | null }) => void
  setAudioLanguage: (audioLanguage: string | null) => void
  setOpensInRavenPlayer: (isOn: boolean) => void
  setControlsLingerSeconds: (seconds: number) => void
  setAutoplay: (isOn: boolean) => void
}

/**
 * zustand's persist falls back to `window.localStorage` when it has no storage,
 * which this module must not touch, and it only gains `persist.setOptions`
 * when it starts with one. This holds the place until `configurePlayerPrefs`.
 */
const UNCONFIGURED: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}

/**
 * Volume, subtitles, audio language, how long the controls linger and
 * autoplay carry over from one video to the next, and across visits.
 */
export const usePlayerPrefs = create<PlayerPrefs>()(
  persist(
    (set) => ({
      volume: 1,
      muted: false,
      captionScale: 1,
      subtitles: { on: false, language: null },
      audioLanguage: null,
      opensInRavenPlayer: false,
      controlsLingerSeconds: CONTROLS_LINGER_SECONDS.initial,
      autoplay: true,
      setVolume: ({ volume, muted }) => set({ volume, muted }),
      setCaptionScale: (captionScale) => set({ captionScale }),
      setSubtitles: (subtitles) => set({ subtitles }),
      setAudioLanguage: (audioLanguage) => set({ audioLanguage }),
      setOpensInRavenPlayer: (isOn) => set({ opensInRavenPlayer: isOn }),
      setControlsLingerSeconds: (seconds) => set({ controlsLingerSeconds: withinLinger(seconds) }),
      setAutoplay: (isOn) => set({ autoplay: isOn }),
    }),
    {
      name: PLAYER_PREFS_KEY,
      storage: createJSONStorage(() => UNCONFIGURED),
      skipHydration: true,
      partialize: ({
        volume,
        muted,
        captionScale,
        subtitles,
        audioLanguage,
        opensInRavenPlayer,
        controlsLingerSeconds,
        autoplay,
      }) => ({
        volume,
        muted,
        captionScale,
        subtitles,
        audioLanguage,
        opensInRavenPlayer,
        controlsLingerSeconds,
        autoplay,
      }),
    },
  ),
)

/**
 * Gives the prefs the host's storage and loads what it holds. A host calls it
 * once, before anything renders: `window.localStorage` on the web and the
 * desktop, AsyncStorage in the app.
 */
export const configurePlayerPrefs = async ({
  storage,
}: {
  storage: StateStorage
}): Promise<void> => {
  usePlayerPrefs.persist.setOptions({ storage: createJSONStorage(() => storage) })
  await usePlayerPrefs.persist.rehydrate()
}
