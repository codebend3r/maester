import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type PlayerPrefs = {
  volume: number
  muted: boolean
  /** Multiplies the subtitle size; `+` and `-` step it. */
  captionScale: number
  /** Whether subtitles were last on, and in which language. */
  subtitles: { on: boolean; language: string | null }
  /** The audio language last picked by hand; null while the file's default has been fine. */
  audioLanguage: string | null
  setVolume: ({ volume, muted }: { volume: number; muted: boolean }) => void
  setCaptionScale: (captionScale: number) => void
  setSubtitles: (subtitles: { on: boolean; language: string | null }) => void
  setAudioLanguage: (audioLanguage: string | null) => void
}

/** Volume, subtitles and audio language carry over from one video to the next, and across visits. */
export const usePlayerPrefs = create<PlayerPrefs>()(
  persist(
    (set) => ({
      volume: 1,
      muted: false,
      captionScale: 1,
      subtitles: { on: false, language: null },
      audioLanguage: null,
      setVolume: ({ volume, muted }) => set({ volume, muted }),
      setCaptionScale: (captionScale) => set({ captionScale }),
      setSubtitles: (subtitles) => set({ subtitles }),
      setAudioLanguage: (audioLanguage) => set({ audioLanguage }),
    }),
    {
      name: 'raven-player',
      storage: createJSONStorage(() => window.localStorage),
      partialize: ({ volume, muted, captionScale, subtitles, audioLanguage }) => ({
        volume,
        muted,
        captionScale,
        subtitles,
        audioLanguage,
      }),
    },
  ),
)
