import type { Track } from '@raven/core'
import { qualityLineOf } from '@raven/wren'

import { usePlayedStreams } from '@/stores/playedStreams'

type UseQualityProps = { track: Track }

/** The format and quality of what plays, "FLAC · 16-bit / 44.1 kHz · 912 kbps"; null until its source is made. */
export const useQuality = ({ track }: UseQualityProps): string | null => {
  const stream = usePlayedStreams((store) => store.streams[track.id])
  return stream === undefined ? null : qualityLineOf({ track, stream })
}
