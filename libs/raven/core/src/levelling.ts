import type { Track } from '@/contract/music'

/** How playback levels loudness: not at all, each track to the reference, or each album as a whole. */
export const LEVELLING_MODES = { off: 'off', track: 'track', album: 'album' } as const

export type LevellingMode = (typeof LEVELLING_MODES)[keyof typeof LEVELLING_MODES]

/** Albums play as their tracks were mastered against each other. */
export const DEFAULT_LEVELLING_MODE: LevellingMode = LEVELLING_MODES.album

type LevelOfProps = { track: Pick<Track, 'gain'>; mode: LevellingMode }

type Chosen = { gain: number | null; peak: number | null }

const chosenOf = ({ track: { gain }, mode }: LevelOfProps): Chosen => {
  switch (mode) {
    case LEVELLING_MODES.off:
      return { gain: null, peak: null }
    case LEVELLING_MODES.track:
      return { gain: gain.track, peak: gain.trackPeak }
    case LEVELLING_MODES.album:
      return gain.album === null
        ? { gain: gain.track, peak: gain.trackPeak }
        : { gain: gain.album, peak: gain.albumPeak ?? gain.trackPeak }
    default: {
      const unknown: never = mode
      return unknown
    }
  }
}

/**
 * The factor a track's volume is multiplied by: its gain in `mode`, held
 * under the level that would clip its peak and never above 1, so levelling
 * only ever turns a track down. No gain, as with a scan that failed, is 1.
 */
export const levelOf = (props: LevelOfProps): number => {
  const { gain, peak } = chosenOf(props)
  if (gain === null) return 1
  return Math.min(10 ** (gain / 20), peak === null || peak <= 0 ? 1 : 1 / peak, 1)
}
