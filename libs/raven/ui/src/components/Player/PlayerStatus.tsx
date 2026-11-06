import type { MediaItem, PlaybackMode, StreamQuality } from '@raven/core'
import { PLAYBACK_MODE_NAMES, STAGE_COPY } from '@/components/Player/copy'
import { playingRange, playingResolution } from '@/components/Player/playbackFacts'
import styles from '@/components/Player/PlayerStatus.module.scss'
import { PictureChip, RangeChip, ResolutionChip } from '@/components/ResolutionChip/ResolutionChip'
import { useClock } from '@/lib/useClock'

type PlayerStatusProps = {
  media: MediaItem | null
  mode: PlaybackMode
  quality: StreamQuality | null
}

/**
 * The far end of the top bar: the time of day, and how the video is playing
 * (the size and range that reach the screen, and the way they get there) as chips.
 */
export const PlayerStatus = ({ media, mode, quality }: PlayerStatusProps) => {
  const clock = useClock()
  const resolution = playingResolution({ media, mode, quality })
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
        {range != null && (
          <li>
            <RangeChip range={range} />
          </li>
        )}
        <li>
          <PictureChip>{PLAYBACK_MODE_NAMES[mode]}</PictureChip>
        </li>
      </ul>
    </div>
  )
}
