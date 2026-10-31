import {
  AUDIO_BITRATES,
  type CrossfadeSeconds,
  DEFAULT_LEVELLING_MODE,
  type Equalizer,
  FLAT_EQUALIZER,
  LEVELLING_MODES,
  type LevellingMode,
  isCrossfadeSeconds,
  isEqualizer,
  isRecord,
  oneOf,
} from '@raven/core'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { UNCONFIGURED_STORAGE } from '@/stores/storage'

/** The key the prefs are stored under. */
export const PLAYER_PREFS_KEY = 'raven-player'

/** How many seconds the player's controls linger once nothing stirs: the slider's ends and where it starts. */
export const CONTROLS_LINGER_SECONDS = { min: 3, max: 10, initial: 5 } as const

/** How many seconds the countdown to what is up next runs: the slider's ends and where it starts. */
export const AUTOPLAY_COUNTDOWN_SECONDS = { min: 5, max: 60, initial: 15 } as const

/** The speeds an audiobook plays at, slowest first; 1 is as it was read. */
export const AUDIOBOOK_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const

export type AudiobookSpeed = (typeof AUDIOBOOK_SPEEDS)[number]

/** The offered speed nearest `speed`, so a stored value from elsewhere still plays at one of them. */
const nearestSpeed = (speed: number): AudiobookSpeed =>
  AUDIOBOOK_SPEEDS.reduce<AudiobookSpeed>(
    (best, offered) => (Math.abs(offered - speed) < Math.abs(best - speed) ? offered : best),
    1,
  )

/** What music plays from: the file as it is, or an AAC transcode at one of its bitrates. */
export const MUSIC_QUALITIES = { original: 'original', ...AUDIO_BITRATES } as const

export type MusicQuality = (typeof MUSIC_QUALITIES)[keyof typeof MUSIC_QUALITIES]

const isMusicQuality = oneOf(Object.values(MUSIC_QUALITIES))

const isLevellingMode = oneOf(Object.values(LEVELLING_MODES))

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
  /** Whether a known intro is skipped without asking, once per title, with a moment to undo it. */
  autoSkipIntro: boolean
  /** Whether the first video's tip about the keyboard has shown; it shows once, ever. */
  hasSeenShortcutsTip: boolean
  /** How fast audiobooks play; music always plays at 1. */
  audiobookSpeed: AudiobookSpeed
  /** Whether music plays from its file or a transcode at a bitrate. */
  musicQuality: MusicQuality
  /** How loudness is levelled from track to track. */
  levelling: LevellingMode
  /** How many seconds one track fades into the next; 0 for none. */
  crossfade: CrossfadeSeconds
  equalizer: Equalizer
  setVolume: ({ volume, muted }: SetVolumeProps) => void
  setCaptionScale: (captionScale: number) => void
  setSubtitles: (subtitles: SetSubtitlesProps) => void
  setAudioLanguage: (audioLanguage: string | null) => void
  setOpensInRavenPlayer: (isOn: boolean) => void
  setControlsLingerSeconds: (seconds: number) => void
  setAutoplay: (isOn: boolean) => void
  setAutoplayCountdownSeconds: (seconds: number) => void
  setAutoSkipIntro: (isOn: boolean) => void
  markShortcutsTipSeen: () => void
  setAudiobookSpeed: (speed: number) => void
  setMusicQuality: (musicQuality: MusicQuality) => void
  setLevelling: (levelling: LevellingMode) => void
  setCrossfade: (crossfade: CrossfadeSeconds) => void
  setEqualizer: (equalizer: Equalizer) => void
}

type SoundPrefs = Pick<PlayerPrefs, 'musicQuality' | 'levelling' | 'crossfade' | 'equalizer'>

type StoredSoundOfProps = { stored: Record<string, unknown>; current: SoundPrefs }

/** The sound prefs a stored copy holds, each kept only when it is one this build knows. */
const storedSoundOf = ({ stored, current }: StoredSoundOfProps): SoundPrefs => ({
  musicQuality: isMusicQuality(stored.musicQuality) ? stored.musicQuality : current.musicQuality,
  levelling: isLevellingMode(stored.levelling) ? stored.levelling : current.levelling,
  crossfade: isCrossfadeSeconds(stored.crossfade) ? stored.crossfade : current.crossfade,
  equalizer: isEqualizer(stored.equalizer) ? stored.equalizer : current.equalizer,
})

/**
 * Volume, subtitles, audio language, how long the controls linger,
 * autoplay and its countdown, skipping intros, whether the keyboard tip
 * has shown, how fast audiobooks play and how music sounds carry over from one video to the next, and across visits.
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
        autoSkipIntro: false,
        hasSeenShortcutsTip: false,
        audiobookSpeed: 1,
        musicQuality: MUSIC_QUALITIES.original,
        levelling: DEFAULT_LEVELLING_MODE,
        crossfade: 0,
        equalizer: FLAT_EQUALIZER,
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
        setAutoSkipIntro: (isOn) => set({ autoSkipIntro: isOn }),
        markShortcutsTipSeen: () => set({ hasSeenShortcutsTip: true }),
        setAudiobookSpeed: (speed) => set({ audiobookSpeed: nearestSpeed(speed) }),
        setMusicQuality: (musicQuality) => set({ musicQuality }),
        setLevelling: (levelling) => set({ levelling }),
        setCrossfade: (crossfade) => set({ crossfade }),
        setEqualizer: (equalizer) => set({ equalizer }),
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
          autoSkipIntro,
          hasSeenShortcutsTip,
          audiobookSpeed,
          musicQuality,
          levelling,
          crossfade,
          equalizer,
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
          autoSkipIntro,
          hasSeenShortcutsTip,
          audiobookSpeed,
          musicQuality,
          levelling,
          crossfade,
          equalizer,
        }),
        // The sound prefs feed the audio graph, so a stored one this build does not know is dropped.
        merge: (stored, current) =>
          isRecord(stored)
            ? { ...current, ...stored, ...storedSoundOf({ stored, current }) }
            : current,
      },
    ),
    { name: 'raven/playerPrefs' },
  ),
)
