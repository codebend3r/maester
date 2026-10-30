import { artistNames } from '@raven/core'
import { Button } from '@raven/ui'
import { AUDIO_STATES, playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { Link, useLocation } from 'react-router-dom'
import { AlbumCover } from '@/components/AlbumCover/AlbumCover'
import { NOW_PLAYING_PATH } from '@/lib/music'
import { POSTER_SIZES } from '@/lib/posters'
import styles from '@/components/NowPlayingBar/NowPlayingBar.module.scss'

/**
 * The strip under the page while music plays: the cover, the title and
 * artists (a link to Now Playing), previous, play or pause and next, and a
 * thin line of how far through the track it is. Gone when nothing is
 * queued, and on Now Playing itself, which has the controls large.
 */
export const NowPlayingBar = () => {
  const track = useAudioQueue(playingTrackOf)
  const state = useAudioQueue((store) => store.state)
  const position = useAudioQueue((store) => store.position)
  const duration = useAudioQueue((store) => store.duration)
  const error = useAudioQueue((store) => store.error)
  const toggle = useAudioQueue((store) => store.toggle)
  const skipNext = useAudioQueue((store) => store.next)
  const skipPrevious = useAudioQueue((store) => store.previous)
  const { pathname } = useLocation()
  if (track === null || pathname === NOW_PLAYING_PATH) return null
  const isPlaying = state === AUDIO_STATES.playing || state === AUDIO_STATES.loading
  const fraction = duration === null || duration === 0 ? 0 : Math.min(position / duration, 1)
  return (
    <section className={styles.bar} aria-label="Now playing">
      <Link to={NOW_PLAYING_PATH} className={styles.cover} aria-label="Now playing">
        <AlbumCover
          album={{
            id: track.albumId,
            title: track.album.title,
            coverVersion: track.album.coverVersion,
          }}
          sizes={POSTER_SIZES.bar}
        />
      </Link>
      <Link to={NOW_PLAYING_PATH} className={styles.words}>
        <span className={styles.title}>{track.title}</span>
        <span className={styles.artists}>{error === null ? artistNames(track) : error}</span>
      </Link>
      <div className={styles.controls}>
        <Button
          tone="ghost"
          icon="skipPrevious"
          aria-label="Previous track"
          onClick={skipPrevious}
        />
        <Button
          tone="ghost"
          icon={isPlaying ? 'pause' : 'play'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={toggle}
        />
        <Button tone="ghost" icon="skipNext" aria-label="Next track" onClick={skipNext} />
      </div>
      <div className={styles.progress} aria-hidden="true">
        <span className={styles.played} style={{ transform: `scaleX(${fraction})` }} />
      </div>
    </section>
  )
}
