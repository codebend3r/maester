import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { UNCONFIGURED_STORAGE } from '@/stores/storage'

/** The key the prefs are stored under. */
export const PLAYER_PREFS_KEY = 'raven-player'

/** How many seconds the player's controls linger once nothing stirs: the slider's ends and where it starts. */
export const CONTROLS_LINGER_SECONDS = { min: 3, max: 10, initial: 5 } as const

/** How many seconds the countdown to what is up next runs: the slider's ends and where it starts. */
export const AUTOPLAY_COUNTDOWN_SECONDS = { min: 5, max: 60, initial: 15 } as const

type WithinProps = {
  seconds: number
  range: { min: number; max: number }
}

/** A whole number of seconds within a slider's ends. */
const within = ({ seconds, range }: WithinProps): number =>
  Math.min(range.max, Math.max(range.min, Math.round(seconds)))

type SetVolumeProps = { volume: number; muted: boolean }

type SetSubtitlesProps = { on: boolean; language: string | null }

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
  /** Whether what is up next starts by itself once the countdown to it runs out. */
  autoplay: boolean
  /** How many seconds the countdown to what is up next runs before it plays. */
  autoplayCountdownSeconds: number
  setVolume: ({ volume, muted }: SetVolumeProps) => void
  setCaptionScale: (captionScale: number) => void
  setSubtitles: (subtitles: SetSubtitlesProps) => void
  setAudioLanguage: (audioLanguage: string | null) => void
  setOpensInRavenPlayer: (isOn: boolean) => void
  setControlsLingerSeconds: (seconds: number) => void
  setAutoplay: (isOn: boolean) => void
  setAutoplayCountdownSeconds: (seconds: number) => void
}

/**
 * Volume, subtitles, audio language, how long the controls linger,
 * autoplay and its countdown carry over from one video to the next, and across visits.
 */
export const usePlayerPrefs = create<PlayerPrefs>()(
  devtools(
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
        autoplayCountdownSeconds: AUTOPLAY_COUNTDOWN_SECONDS.initial,
        setVolume: ({ volume, muted }) => set({ volume, muted }),
        setCaptionScale: (captionScale) => set({ captionScale }),
        setSubtitles: (subtitles) => set({ subtitles }),
        setAudioLanguage: (audioLanguage) => set({ audioLanguage }),
        setOpensInRavenPlayer: (isOn) => set({ opensInRavenPlayer: isOn }),
        setControlsLingerSeconds: (seconds) =>
          set({ controlsLingerSeconds: within({ seconds, range: CONTROLS_LINGER_SECONDS }) }),
        setAutoplay: (isOn) => set({ autoplay: isOn }),
        setAutoplayCountdownSeconds: (seconds) =>
          set({
            autoplayCountdownSeconds: within({ seconds, range: AUTOPLAY_COUNTDOWN_SECONDS }),
          }),
      }),
      {
        name: PLAYER_PREFS_KEY,
        storage: createJSONStorage(() => UNCONFIGURED_STORAGE),
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
          autoplayCountdownSeconds,
        }) => ({
          volume,
          muted,
          captionScale,
          subtitles,
          audioLanguage,
          opensInRavenPlayer,
          controlsLingerSeconds,
          autoplay,
          autoplayCountdownSeconds,
        }),
      },
    ),
    { name: 'raven/playerPrefs' },
  ),
)
