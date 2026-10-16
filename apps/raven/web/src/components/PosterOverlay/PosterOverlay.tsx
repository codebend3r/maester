import { Icon } from '@raven/ui'
import type { MediaItem } from '@raven/core'
import { CardLink } from '@/components/CardLink/CardLink'
import { ResolutionChip } from '@/components/ResolutionChip/ResolutionChip'
import styles from '@/components/PosterOverlay/PosterOverlay.module.scss'
import type { AppPath } from '@/lib/itemLinks'

/**
 * What a card lays over its poster: the video's resolution at the top and,
 * given a link, a play button at the bottom. It reveals both while its card,
 * the parent, is pointed at or focused, and always on touch screens.
 */
export const PosterOverlay = ({
  media,
  play,
}: {
  media: MediaItem
  play: { to: AppPath; state?: unknown; label: string } | null
}) => (
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
