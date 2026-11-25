import type { Track } from '@raven/core'
import { usePlayedQuality } from '@raven/native/headless'

import type { PlayingQuality } from '@/layouts/musicKit'
import { playingQualityOf } from '@/layouts/musicRows'

type UsePlayingQualityProps = { track: Track | null }

/** The format and quality line of what plays, as the layouts draw it; null until its source is made. */
export const usePlayingQuality = ({ track }: UsePlayingQualityProps): PlayingQuality | null => {
  const quality = usePlayedQuality({ track })
  return quality === null ? null : playingQualityOf(quality)
}
