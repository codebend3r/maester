import { artistNames, formatDuration, type Track } from '@raven/core'
import { BUTTON_TONES, ButtonLink, classNames } from '@raven/ui'
import { AUDIO_STATES, hasPlayingTrackOf, playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AudioQualityLine } from '@/components/AudioQualityLine/AudioQualityLine'
import { Equalizer } from '@/components/Equalizer/Equalizer'
import { AlbumCover } from '@/components/AlbumCover/AlbumCover'
import { useTrackMenu } from '@/components/MusicMenu/useMusicMenu'
import { NOW_PLAYING_BAR_COPY } from '@/components/NowPlayingBar/copy'
import { TrackHeart } from '@/components/TrackHeart/TrackHeart'
import { Transport } from '@/components/Transport/Transport'
import { VolumeControl } from '@/components/VolumeControl/VolumeControl'
import { PANE_COPY, PANES, paneLink } from '@/lib/nowPlayingPanes'
import { useAudioQuality } from '@/lib/useAudioQuality'
import { useMusicLinks } from '@/lib/useMusicLinks'
import { POSTER_SIZES } from '@/lib/posters'
import styles from '@/components/NowPlayingBar/NowPlayingBar.module.scss'

type PlayingStripProps = { track: Track }

const PlayingStrip = ({ track }: PlayingStripProps) => {
  const state = useAudioQueue((store) => store.state)
  const position = useAudioQueue((store) => store.position)
  const duration = useAudioQueue((store) => store.duration)
  const error = useAudioQueue((store) => store.error)
  const links = useMusicLinks()
  const seekTo = useAudioQueue((store) => store.seekTo)
  const quality = useAudioQuality({ track })
  const { coverProps, coverClass, menu } = useTrackMenu({ track })
  const [hoverFraction, setHoverFraction] = useState<number | null>(null)
  const length = duration ?? track.duration ?? 0
  const fraction = length > 0 ? Math.min(position / length, 1) : 0
  return (
    <section className={styles.bar} aria-label={NOW_PLAYING_BAR_COPY.miniPlayer}>
      <div className={styles.track}>
        <Link
          to={links.nowPlaying}
          className={classNames([styles.cover, coverClass])}
          aria-label={NOW_PLAYING_BAR_COPY.nowPlaying}
          {...coverProps}
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
        {menu}
        <Link to={links.nowPlaying} className={styles.words}>
          <span className={styles.title}>{track.title}</span>
          <span className={styles.artists}>{error === null ? artistNames(track) : error}</span>
          <span className={styles.time}>
            {formatDuration(position)} / {formatDuration(duration ?? track.duration)}
          </span>
        </Link>
        <div className={styles.liked}>
          <Equalizer isPlaying={state === AUDIO_STATES.playing} />
          <TrackHeart track={track} />
        </div>
      </div>
      <Transport className={styles.controls} />
      <div className={styles.more}>
        {quality !== null && <AudioQualityLine quality={quality} className={styles.quality} />}
        <ButtonLink
          tone={BUTTON_TONES.ghost}
          icon="list"
          to={paneLink({ nowPlaying: links.nowPlaying, pane: PANES.queue })}
          aria-label={PANE_COPY.upNext}
        />
        <ButtonLink
          tone={BUTTON_TONES.ghost}
          icon="captions"
          to={paneLink({ nowPlaying: links.nowPlaying, pane: PANES.extras })}
          aria-label={PANE_COPY.lyrics}
        />
        <VolumeControl className={styles.volume} />
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
 * The strip under the page while music plays, in three parts: the cover, the title and artists
 * (a link to Now Playing) and the track's heart; previous, play or pause and next; then, on a
 * wide window, the format and quality it plays in, Up next and Lyrics, which open Now Playing on
 * that tab, and the volume. A thin line over it shows how far through the track it is. A narrow
 * window keeps the first two parts. It never stops the
 * music: Clear, over the queue, does. Gone when nothing is queued, and on Now Playing itself,
 * which has the controls large.
 */
export const NowPlayingBar = () => {
  const track = useAudioQueue(playingTrackOf)
  return useIsBarShown() && track !== null && <PlayingStrip track={track} />
}

/** Whether the bar shows: while a track is queued, anywhere but Now Playing. */
export const useIsBarShown = (): boolean => {
  const isQueued = useAudioQueue(hasPlayingTrackOf)
  const { pathname } = useLocation()
  const { nowPlaying } = useMusicLinks()
  return isQueued && pathname !== nowPlaying
}
