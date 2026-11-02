import { artistNames, formatDuration, type Track } from '@raven/core'
import { Button } from '@raven/ui'
import { AUDIO_STATES, playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Equalizer } from '@/components/Equalizer/Equalizer'
import { AlbumCover } from '@/components/AlbumCover/AlbumCover'
import { NOW_PLAYING_BAR_COPY } from '@/components/NowPlayingBar/copy'
import { useMusicLinks } from '@/lib/useMusicLinks'
import { POSTER_SIZES } from '@/lib/posters'
import styles from '@/components/NowPlayingBar/NowPlayingBar.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type PlayingStripProps = { track: Track }

const PlayingStrip = ({ track }: PlayingStripProps) => {
  const state = useAudioQueue((store) => store.state)
  const position = useAudioQueue((store) => store.position)
  const duration = useAudioQueue((store) => store.duration)
  const error = useAudioQueue((store) => store.error)
  const clear = useAudioQueue((store) => store.clear)
  const toggle = useAudioQueue((store) => store.toggle)
  const skipNext = useAudioQueue((store) => store.next)
  const skipPrevious = useAudioQueue((store) => store.previous)
  const links = useMusicLinks()
  const seekTo = useAudioQueue((store) => store.seekTo)
  const [hoverFraction, setHoverFraction] = useState<number | null>(null)
  const length = duration ?? track.duration ?? 0
  const isPlaying = state === AUDIO_STATES.playing || state === AUDIO_STATES.loading
  const fraction = length > 0 ? Math.min(position / length, 1) : 0
  return (
    <section className={styles.bar} aria-label={NOW_PLAYING_BAR_COPY.miniPlayer}>
      <Link
        to={links.nowPlaying}
        className={styles.cover}
        aria-label={NOW_PLAYING_BAR_COPY.nowPlaying}
      >
        <AlbumCover
          album={{
            id: track.albumId,
            title: track.album.title,
            coverVersion: track.album.coverVersion,
          }}
          sizes={POSTER_SIZES.bar}
        />
      </Link>
      <Link to={links.nowPlaying} className={styles.words}>
        <span className={styles.title}>{track.title}</span>
        <span className={styles.artists}>{error === null ? artistNames(track) : error}</span>
        <span className={styles.time}>
          {formatDuration(position)} / {formatDuration(duration ?? track.duration)}
        </span>
      </Link>
      <div className={styles.controls}>
        <Equalizer isPlaying={state === AUDIO_STATES.playing} />
        <Button
          tone="ghost"
          icon="skipPrevious"
          aria-label={NOW_PLAYING_BAR_COPY.previousTrack}
          onClick={skipPrevious}
        />
        <Button
          tone="ghost"
          icon={isPlaying ? 'pause' : 'play'}
          aria-label={isPlaying ? COMMON_COPY.pause : COMMON_COPY.play}
          onClick={toggle}
        />
        <Button
          tone="ghost"
          icon="skipNext"
          aria-label={NOW_PLAYING_BAR_COPY.nextTrack}
          onClick={skipNext}
        />
        <Button tone="ghost" icon="close" aria-label={NOW_PLAYING_BAR_COPY.close} onClick={clear} />
      </div>
      <div className={styles.progress}>
        <span
          className={styles.played}
          style={{ transform: `scaleX(${fraction})` }}
          aria-hidden="true"
        />
        <input
          type="range"
          className={styles.seek}
          aria-label={NOW_PLAYING_BAR_COPY.position}
          aria-valuetext={`${formatDuration(position)} / ${formatDuration(length)}`}
          min={0}
          max={Math.max(length, 1)}
          step={1}
          value={Math.min(position, length)}
          disabled={length <= 0}
          onChange={(event) => seekTo(Number(event.target.value))}
          onMouseMove={(event) => {
            const { left, width } = event.currentTarget.getBoundingClientRect()
            if (width <= 0) return
            setHoverFraction(Math.max(0, Math.min((event.clientX - left) / width, 1)))
          }}
          onMouseLeave={() => setHoverFraction(null)}
        />
        {hoverFraction !== null && length > 0 && (
          <span
            className={styles.hoverTime}
            style={{
              left: `clamp(var(--space-5), ${hoverFraction * 100}%, calc(100% - var(--space-5)))`,
            }}
            aria-hidden="true"
          >
            {formatDuration(Math.round(hoverFraction * length))}
          </span>
        )}
      </div>
    </section>
  )
}

/**
 * The strip under the page while music plays: the cover, the title and
 * artists (a link to Now Playing), previous, play or pause and next, and a
 * thin line of how far through the track it is. Gone when nothing is
 * queued, and on Now Playing itself, which has the controls large.
 */
export const NowPlayingBar = () => {
  const track = useAudioQueue(playingTrackOf)
  return useIsBarShown() && track !== null && <PlayingStrip track={track} />
}

/** Whether the bar shows: while a track is queued, anywhere but Now Playing. */
export const useIsBarShown = (): boolean => {
  const isQueued = useAudioQueue((store) => playingTrackOf(store) !== null)
  const { pathname } = useLocation()
  const { nowPlaying } = useMusicLinks()
  return isQueued && pathname !== nowPlaying
}
