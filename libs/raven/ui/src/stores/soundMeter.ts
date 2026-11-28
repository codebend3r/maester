import { create } from 'zustand'

type LevelsProps = {
  /** How many bars the reader draws, so the spectrum is split into that many bands, low to high. */
  count: number
}

/** Reads what plays right now: one level per band, each from 0 (silent) to 1 (full). */
export type SoundLevels = (props: LevelsProps) => readonly number[]

/** Lets go of a claimed meter, unless another reader has claimed it since. */
type ReleaseMeter = () => void

type SoundMeterState = {
  /** The reader of what plays now; null while nothing measures the sound. */
  levels: SoundLevels | null
  /** Makes `levels` the reader the bars follow, until the release it returns is called. */
  claim: (levels: SoundLevels) => ReleaseMeter
}

/**
 * The live sound the equalizer bars follow. The web's `AudioHost` claims it with its Web Audio
 * analyser, Raven on the desktop with the levels mpv reports; the bars read it on every frame
 * while their track plays.
 */
export const useSoundMeter = create<SoundMeterState>()((set, get) => ({
  levels: null,
  claim: (levels) => {
    set({ levels })
    return () => {
      if (get().levels === levels) set({ levels: null })
    }
  },
}))
