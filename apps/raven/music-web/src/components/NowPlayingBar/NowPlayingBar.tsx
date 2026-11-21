import type { Track } from '@raven/core'
import { isPlayingOf, playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { progressOf } from '@raven/wren'
import { useNavigate } from 'react-router-dom'
import { useNowPlaying } from '@/player/useNowPlaying'
import { WREN_ROUTES } from '@/routes'
import { MiniPlayer } from '@/ui/MiniPlayer/MiniPlayer'
import styles from '@/components/NowPlayingBar/NowPlayingBar.module.scss'

type TrackBarProps = { track: Track }

function TrackBar({ track }: TrackBarProps) {
  const navigate = useNavigate()
  const { cover, artists, length, error } = useNowPlaying({ track })
  const isPlaying = useAudioQueue(isPlayingOf)
  const position = useAudioQueue((store) => store.position)
  const toggle = useAudioQueue((store) => store.toggle)
  const next = useAudioQueue((store) => store.next)
  return (
    <div className={styles.place}>
      <MiniPlayer
        artists={artists}
        cover={cover}
        error={error}
        isPlaying={isPlaying}
        onNext={next}
        onOpen={() => navigate(WREN_ROUTES.nowPlaying)}
        onToggle={toggle}
        progress={progressOf({ position, length })}
        title={track.title}
      />
    </div>
  )
}

/**
 * The narrow layout's mini player while a track is queued: its cover, title and artists, play or
 * pause and next; pressed, it opens Now Playing. The shell sets it above the tab bar on a tab
 * and at the foot of every other page, and leaves it out on sign-in and Now Playing.
 */
export function NowPlayingBar() {
  const track = useAudioQueue(playingTrackOf)
  return track !== null && <TrackBar track={track} />
}
