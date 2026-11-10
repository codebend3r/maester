import { MUSIC_COPY } from '@/layouts/copy'
import { useAppPrefs } from '@/stores/appPrefs'

/** How much of the square a track with no artwork would have had its cover in the equalizer fills. */
const SQUARE_SHARE = 0.84

type CoverLabelOfProps = { hasCover: boolean; isShown: boolean }

/** What Now Playing's cover says aloud: whether it has artwork, and what a press does to the equalizer. */
export const coverLabelOf = ({ hasCover, isShown }: CoverLabelOfProps): string => {
  if (hasCover) return isShown ? MUSIC_COPY.coverEqualizerOn : MUSIC_COPY.coverEqualizerOff
  return isShown ? MUSIC_COPY.equalizerOn : MUSIC_COPY.equalizerOff
}

type EqualizerBandOfProps = {
  /** How wide the cover stands. */
  size: number
  hasCover: boolean
  /** How much of a cover the skyline takes along its foot, each platform's own. */
  bandShare: number
}

/** How tall the equalizer stands over a cover: a band along its foot, or most of a coverless square. */
export const equalizerBandOf = ({ size, hasCover, bandShare }: EqualizerBandOfProps): number =>
  Math.round(size * (hasCover ? bandShare : SQUARE_SHARE))

type EqualizerShown = { isShown: boolean; toggle: () => void }

/** Whether the equalizer shows over Now Playing's cover on this device, and the press that flips it. */
export const useEqualizerShown = (): EqualizerShown => {
  const isShown = useAppPrefs((prefs) => prefs.isEqualizerShown)
  const change = useAppPrefs((prefs) => prefs.change)
  return { isShown, toggle: () => change({ isEqualizerShown: !isShown }) }
}
