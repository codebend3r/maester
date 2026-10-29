import { REPEAT_MODES, formatDuration, orderedOf } from '@raven/core'
import { Button } from '@raven/ui'
import { AUDIO_STATES, playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { AlbumCover } from '@/components/AlbumCover/AlbumCover'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { TrackList, type TrailProps } from '@/components/TrackList/TrackList'
import { albumPath, artistPath } from '@/lib/music'
import { POSTER_SIZES } from '@/lib/posters'
import styles from '@/pages/NowPlayingPage/NowPlayingPage.module.scss'

const REPEAT_LABELS = {
  [REPEAT_MODES.off]: 'Repeat off',
  [REPEAT_MODES.all]: 'Repeat all',
  [REPEAT_MODES.one]: 'Repeat one',
} as const

type QueueControlsProps = TrailProps

/** A queued row's controls: up one place, and out of the queue. */
const QueueControls = ({ index }: QueueControlsProps) => {
  const move = useAudioQueue((store) => store.move)
  const remove = useAudioQueue((store) => store.remove)
  return (
    <>
      <Button
        tone="ghost"
        icon="up"
        aria-label="Move up"
        disabled={index === 0}
        onClick={() => move({ from: index, to: index - 1 })}
      />
      <Button
        tone="ghost"
        icon="close"
        aria-label="Remove from queue"
        onClick={() => remove(index)}
      />
    </>
  )
}

/**
 * `/now-playing`: the playing track large, with its cover, a scrubber,
 * previous, play or pause, next, shuffle and repeat, and the queue under
 * it, each track playable, removable or moved up. Empty when nothing plays.
 */
export const NowPlayingPage = () => {
  const titleId = useId()
  const queueId = useId()
  const track = useAudioQueue(playingTrackOf)
  const queue = useAudioQueue((store) => store.queue)
  const tracks = useAudioQueue((store) => store.tracks)
  const state = useAudioQueue((store) => store.state)
  const position = useAudioQueue((store) => store.position)
  const duration = useAudioQueue((store) => store.duration)
  const error = useAudioQueue((store) => store.error)
  const toggle = useAudioQueue((store) => store.toggle)
  const skipNext = useAudioQueue((store) => store.next)
  const skipPrevious = useAudioQueue((store) => store.previous)
  const seekTo = useAudioQueue((store) => store.seekTo)
  const jump = useAudioQueue((store) => store.jump)
  const toggleShuffle = useAudioQueue((store) => store.toggleShuffle)
  const cycleRepeat = useAudioQueue((store) => store.cycleRepeat)
  const clear = useAudioQueue((store) => store.clear)

  if (track === null) {
    return (
      <section className={styles.page} aria-labelledby={titleId}>
        <BackButton fallback={HOME} className={styles.back} />
        <h1 id={titleId} className={styles.title}>
          Now playing
        </h1>
        <p className={styles.empty}>
          Nothing is playing. Open an album and press Play, or add tracks to the queue.
        </p>
      </section>
    )
  }

  const isPlaying = state === AUDIO_STATES.playing || state === AUDIO_STATES.loading
  const ordered = orderedOf(queue).flatMap(({ id }) => {
    const queued = tracks[id]
    return queued === undefined ? [] : [queued]
  })
  const length = duration ?? track.duration ?? 0

  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <BackButton fallback={HOME} className={styles.back} />
      <h1 id={titleId} className="visually-hidden">
        Now playing
      </h1>
      <div className={styles.stage}>
        <div className={styles.cover}>
          <AlbumCover
            album={{
              id: track.albumId,
              title: track.album.title,
              coverVersion: track.album.coverVersion,
            }}
            sizes={POSTER_SIZES.nowPlaying}
          />
        </div>
        <div className={styles.words}>
          <h2 className={styles.trackTitle}>{track.title}</h2>
          <p className={styles.artists}>
            {track.artists.map((artist, index) => (
              <span key={artist.id}>
                {index > 0 && ', '}
                <Link to={artistPath(artist.id)}>{artist.name}</Link>
              </span>
            ))}
          </p>
          <p className={styles.album}>
            <Link to={albumPath(track.albumId)}>{track.album.title}</Link>
          </p>
          {error !== null && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
        <div className={styles.scrubber}>
          <span className={`${styles.time} ${styles.played}`}>{formatDuration(position)}</span>
          <input
            type="range"
            className={styles.range}
            aria-label="Position"
            min={0}
            max={Math.max(length, 1)}
            step={1}
            value={Math.min(position, length)}
            onChange={(event) => seekTo(Number(event.target.value))}
          />
          <span className={`${styles.time} ${styles.left}`}>{formatDuration(length)}</span>
        </div>
        <div className={styles.controls}>
          <Button
            tone="ghost"
            icon="shuffle"
            aria-label={queue.isShuffled ? 'Shuffle on' : 'Shuffle off'}
            aria-pressed={queue.isShuffled}
            onClick={toggleShuffle}
          />
          <Button
            tone="ghost"
            icon="skipPrevious"
            aria-label="Previous track"
            onClick={skipPrevious}
          />
          <Button
            tone="primary"
            size="large"
            icon={isPlaying ? 'pause' : 'play'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            onClick={toggle}
          />
          <Button tone="ghost" icon="skipNext" aria-label="Next track" onClick={skipNext} />
          <Button
            tone="ghost"
            icon="reset"
            aria-label={REPEAT_LABELS[queue.repeat]}
            aria-pressed={queue.repeat !== REPEAT_MODES.off}
            onClick={cycleRepeat}
          >
            {queue.repeat === REPEAT_MODES.one ? '1' : undefined}
          </Button>
        </div>
      </div>
      <section className={styles.queue} aria-labelledby={queueId}>
        <SectionHeading
          id={queueId}
          aside={
            <Button tone="quiet" icon="close" onClick={clear}>
              Clear
            </Button>
          }
        >
          Queue
        </SectionHeading>
        <TrackList
          tracks={ordered}
          onPlay={jump}
          currentPlace={queue.at}
          numberOf={({ index }) => index + 1}
          Trail={QueueControls}
          label="Queue"
        />
      </section>
    </section>
  )
}
