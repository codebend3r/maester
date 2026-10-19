import { type MediaItem, progressOf } from '@raven/core'
import styles from '@/components/ResumeBar/ResumeBar.module.scss'

/**
 * How far into a video the viewer got, as a line; nothing for one not yet
 * started. Over a picture it sits on a dark track, inline on the ground's
 * own. Where it sits and how thick it is are the container's to say.
 */
export const ResumeBar = ({
  media,
  tone = 'overlay',
  className,
}: {
  media: MediaItem
  tone?: 'overlay' | 'inline'
  className?: string
}) => {
  const progress = progressOf(media)
  if (progress <= 0) return null
  return (
    <span
      className={[styles.bar, styles[tone], className ?? ''].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      <span className={styles.fill} style={{ width: `${progress * 100}%` }} />
    </span>
  )
}

/** The resume line's words, for a screen reader; the line itself is hidden from it. */
export const PartlyWatched = ({ media }: { media: MediaItem }) =>
  progressOf(media) > 0 && <span className="visually-hidden">Partly watched</span>
