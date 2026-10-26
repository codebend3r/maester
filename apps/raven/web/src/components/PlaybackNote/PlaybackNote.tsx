import { type MediaItem, planPlayback } from '@raven/core'
import { Icon } from '@raven/ui'
import { browserCanPlay, browserCanStream } from '@raven/ui/canPlay'
import { usePlaybackPolicy } from '@raven/ui/headless'
import { playbackSettingsQuery } from '@/lib/queries'
import styles from '@/components/PlaybackNote/PlaybackNote.module.scss'

type PlaybackNoteProps = { media: MediaItem }

/**
 * Warns when this browser cannot play a video at all, as the server's
 * playback settings have it. Nothing when it plays, directly or converted
 * on the server, as most 4K files are, or before those settings are known.
 */
export const PlaybackNote = ({ media }: PlaybackNoteProps) => {
  const policy = usePlaybackPolicy({ queries: { playbackSettingsQuery } })
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
