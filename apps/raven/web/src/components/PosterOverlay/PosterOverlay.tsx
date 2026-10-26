import { Icon } from '@raven/ui'
import type { AppPath, MediaItem } from '@raven/core'
import { CardLink } from '@/components/CardLink/CardLink'
import { ResolutionChip } from '@/components/ResolutionChip/ResolutionChip'
import styles from '@/components/PosterOverlay/PosterOverlay.module.scss'

type PosterOverlayProps = {
  media: MediaItem
  play: { to: AppPath; state?: unknown; label: string } | null
}

/**
 * What a card lays over its poster: the video's resolution in the top
 * corner and, given a link, a play button in the bottom one. It reveals both
 * while its card (`[data-entry]`) is pointed at or focused, and always on
 * touch screens. The card moves the resolution aside by `--select-room`
 * while its checkbox shares that corner.
 */
export const PosterOverlay = ({ media, play }: PosterOverlayProps) => (
  <span className={styles.overlay}>
    <span className={styles.quality}>
      <ResolutionChip media={media} />
    </span>
    {play && (
      <CardLink to={play.to} state={play.state} className={styles.play} aria-label={play.label}>
        <Icon name="play" size={18} />
      </CardLink>
    )}
  </span>
)
