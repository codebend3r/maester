import { type MediaItem, planPlayback } from '@raven/core'
import { Icon } from '@/components/Icon/Icon'
import { browserCanPlay, browserCanStream } from '@/lib/canPlay'
import { useSharedPlaybackPolicy } from '@/lib/sharedPlaybackPolicy'
import styles from '@/components/PlaybackNote/PlaybackNote.module.scss'

/**
 * Warns when this browser cannot play a video at all, as the server's
 * playback settings have it. Nothing when it plays, directly or converted
 * on the server, as most 4K files are, or before those settings are known.
 * The settings come from `SharedPlaybackPolicy`, as a grid holds thousands.
 */
export const PlaybackNote = ({ media }: { media: MediaItem }) => {
  const policy = useSharedPlaybackPolicy()
  if (!policy) return null
  const plan = planPlayback({
    media,
    canPlay: browserCanPlay,
    canStream: browserCanStream,
    defaultAudio: true,
    policy,
  })
  if (plan.modes.length > 0) return null
  return (
    <span className={styles.note} title={plan.problems.join(' ')}>
      <Icon name="alert" size={16} />
      Won't play in this browser
    </span>
  )
}
