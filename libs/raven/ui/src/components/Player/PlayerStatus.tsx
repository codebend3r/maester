import type { MediaItem, PlaybackMode, StreamQuality } from '@raven/core'
import type { ReactNode } from 'react'
import { PLAYBACK_MODE_NAMES, STAGE_COPY } from '@/components/Player/copy'
import { playingCodec, playingRange, playingResolution } from '@/components/Player/playbackFacts'
import styles from '@/components/Player/PlayerStatus.module.scss'
import {
  CodecChip,
  PictureChip,
  RangeChip,
  ResolutionChip,
} from '@/components/ResolutionChip/ResolutionChip'
import { useClock } from '@/lib/useClock'

type PlayerStatusProps = {
  media: MediaItem | null
  mode: PlaybackMode
  quality: StreamQuality | null
  /** What plays next, under the chips, when the title came with more after it. */
  children?: ReactNode
}

/**
 * The far end of the top bar, one thing under another: the time of day, how
 * the video is playing as chips (the size, codec and range that reach the
 * screen, and the way they get there), then what plays next.
 */
export const PlayerStatus = ({ media, mode, quality, children }: PlayerStatusProps) => {
  const clock = useClock()
  const resolution = playingResolution({ media, mode, quality })
  const codec = playingCodec({ media, mode })
  const range = playingRange({ media, mode })
  return (
    <div className={styles.status}>
      <span className={styles.clock}>{clock}</span>
      <ul className={styles.chips} aria-label={STAGE_COPY.playingAs}>
        {resolution != null && (
          <li>
            <ResolutionChip resolution={resolution} />
          </li>
        )}
        {codec != null && (
          <li>
            <CodecChip codec={codec} />
          </li>
        )}
        {range != null && (
          <li>
            <RangeChip range={range} />
          </li>
        )}
        <li>
          <PictureChip>{PLAYBACK_MODE_NAMES[mode]}</PictureChip>
        </li>
      </ul>
      {children}
    </div>
  )
}
