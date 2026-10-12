import { type MediaItem, planPlayback } from '@raven/core'
import { Icon } from '@/components/Icon/Icon'
import { browserCanPlay, browserCanStream } from '@/lib/canPlay'
import { usePlaybackPolicy } from '@/lib/usePlaybackPolicy'
import styles from '@/components/PlaybackNote/PlaybackNote.module.scss'

/**
 * Says when this browser cannot play a video as it is: converted on the
 * server, or not at all, as the server's playback settings have it. Nothing
 * when it plays directly, or before those settings are known. A card only
 * warns of a video that will not play: most 4K files are converted, so on a
 * card that says nothing worth choosing by, and the video's page says it.
 */
export const PlaybackNote = ({ media, place }: { media: MediaItem; place: 'card' | 'page' }) => {
  const policy = usePlaybackPolicy()
  if (!policy) return null
  const plan = planPlayback({
    media,
    canPlay: browserCanPlay,
    canStream: browserCanStream,
    defaultAudio: true,
    policy,
  })
  const converted = place === 'page' && plan.modes.length > 0 && plan.modes[0] !== 'direct'
  return (
    <>
      {plan.modes.length === 0 && (
        <span className={styles.note} title={plan.problems.join(' ')}>
          <Icon name="alert" size={16} />
          Won't play in this browser
        </span>
      )}
      {converted && (
        <span className={styles.note} title={plan.problems.join(' ')}>
          <Icon name="rescan" size={16} />
          Converted on the server
        </span>
      )}
    </>
  )
}
