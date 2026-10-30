import { type Chapter, REPEAT_MODES, type Track, formatDuration, orderedOf } from '@raven/core'
import { Button } from '@raven/ui'
import {
  AUDIOBOOK_SPEEDS,
  AUDIO_STATES,
  nextChapterStart,
  playingTrackOf,
  previousChapterStart,
  useAudioQueue,
  useAudiobookChapters,
  usePlayerPrefs,
  KeyedView,
  type ViewOf,
  type ViewsOf,
} from '@raven/ui/headless'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { AddToPlaylistDialog } from '@/components/AddToPlaylistDialog/AddToPlaylistDialog'
import { AlbumCover } from '@/components/AlbumCover/AlbumCover'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { TrackList, type TrailProps } from '@/components/TrackList/TrackList'
import { api } from '@/lib/api'
import { albumPath, artistPath } from '@/lib/music'
import { POSTER_SIZES } from '@/lib/posters'
import { ChaptersPanel } from '@/pages/NowPlayingPage/ChaptersPanel'
import { LyricsPanel } from '@/pages/NowPlayingPage/LyricsPanel'
import { NOW_PLAYING_COPY } from '@/pages/NowPlayingPage/copy'
import styles from '@/pages/NowPlayingPage/NowPlayingPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

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
        aria-label={NOW_PLAYING_COPY.moveUp}
        disabled={index === 0}
        onClick={() => move({ from: index, to: index - 1 })}
      />
      <Button
        tone="ghost"
        icon="close"
        aria-label={NOW_PLAYING_COPY.removeFromQueue}
        onClick={() => remove(index)}
      />
    </>
  )
}

/** Where the track is as a skip is pressed, read then rather than on every tick. */
const positionNow = (): number => useAudioQueue.getState().position

type BookControlsProps = { chapters: readonly Chapter[] }

/** An audiobook's own controls: the chapter before and after, and how fast it reads. */
const BookControls = ({ chapters }: BookControlsProps) => {
  const speedId = useId()
  const seekTo = useAudioQueue((store) => store.seekTo)
  const speed = usePlayerPrefs((prefs) => prefs.audiobookSpeed)
  const setSpeed = usePlayerPrefs((prefs) => prefs.setAudiobookSpeed)
  const hasChapters = chapters.length > 0
  const next = () => {
    const start = nextChapterStart({ chapters, at: positionNow() })
    if (start !== null) seekTo(start)
  }
  return (
    <div className={styles.book}>
      <Button
        tone="ghost"
        icon="rewind"
        aria-label={NOW_PLAYING_COPY.previousChapter}
        disabled={!hasChapters}
        onClick={() => seekTo(previousChapterStart({ chapters, at: positionNow() }))}
      />
      <Button
        tone="ghost"
        icon="forward"
        aria-label={NOW_PLAYING_COPY.nextChapter}
        disabled={!hasChapters}
        onClick={next}
      />
      <label className={styles.speed} htmlFor={speedId}>
        <span>{NOW_PLAYING_COPY.speed}</span>
        <select
          id={speedId}
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value))}
        >
          {AUDIOBOOK_SPEEDS.map((offered) => (
            <option key={offered} value={offered}>
              {NOW_PLAYING_COPY.speedOption(offered)}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

const EXTRAS_VIEW_KEYS = { chapters: 'chapters', lyrics: 'lyrics' } as const

type ExtrasViewProps = {
  [EXTRAS_VIEW_KEYS.chapters]: Parameters<typeof ChaptersPanel>[0]
  [EXTRAS_VIEW_KEYS.lyrics]: Parameters<typeof LyricsPanel>[0]
}

const EXTRAS_VIEWS = {
  [EXTRAS_VIEW_KEYS.chapters]: ChaptersPanel,
  [EXTRAS_VIEW_KEYS.lyrics]: LyricsPanel,
} as const satisfies ViewsOf<ExtrasViewProps>

const EXTRAS_HEADINGS = {
  [EXTRAS_VIEW_KEYS.chapters]: NOW_PLAYING_COPY.chapters,
  [EXTRAS_VIEW_KEYS.lyrics]: NOW_PLAYING_COPY.lyrics,
} as const satisfies Record<keyof ExtrasViewProps, string>

type ExtrasViewOfProps = { track: Track; isAudiobook: boolean; chapters: readonly Chapter[] }

/** What sits under the controls: an audiobook's chapters, or a song's lyrics. */
const extrasViewOf = ({
  track,
  isAudiobook,
  chapters,
}: ExtrasViewOfProps): ViewOf<ExtrasViewProps> => {
  if (isAudiobook) return { key: EXTRAS_VIEW_KEYS.chapters, props: { chapters } }
  return { key: EXTRAS_VIEW_KEYS.lyrics, props: { trackId: track.id } }
}

/** The page when nothing plays: its title over a line on how to start something. */
const NothingPlaying = () => {
  const titleId = useId()
  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <BackButton fallback={HOME} className={styles.back} />
      <h1 id={titleId} className={styles.title}>
        {NOW_PLAYING_COPY.title}
      </h1>
      <p className={styles.empty}>{NOW_PLAYING_COPY.empty}</p>
    </section>
  )
}

type PlayingProps = { track: Track }

/**
 * The page while `track` plays: it large, its controls, its lyrics or an
 * audiobook's chapters, and the queue under them.
 */
const Playing = ({ track }: PlayingProps) => {
  const titleId = useId()
  const queueId = useId()
  const extrasId = useId()
  const { isAudiobook, chapters } = useAudiobookChapters({ api, track })
  const [isAdding, setAdding] = useState(false)
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

  const isPlaying = state === AUDIO_STATES.playing || state === AUDIO_STATES.loading
  const ordered = orderedOf(queue).flatMap(({ id }) => {
    const queued = tracks[id]
    return queued === undefined ? [] : [queued]
  })
  const length = duration ?? track.duration ?? 0
  const extras = extrasViewOf({ track, isAudiobook, chapters })

  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <BackButton fallback={HOME} className={styles.back} />
      <h1 id={titleId} className="visually-hidden">
        {NOW_PLAYING_COPY.title}
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
                {index > 0 && COMMON_COPY.listSeparator}
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
            aria-label={NOW_PLAYING_COPY.position}
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
            aria-label={queue.isShuffled ? NOW_PLAYING_COPY.shuffleOn : NOW_PLAYING_COPY.shuffleOff}
            aria-pressed={queue.isShuffled}
            onClick={toggleShuffle}
          />
          <Button
            tone="ghost"
            icon="skipPrevious"
            aria-label={NOW_PLAYING_COPY.previousTrack}
            onClick={skipPrevious}
          />
          <Button
            tone="primary"
            size="large"
            icon={isPlaying ? 'pause' : 'play'}
            aria-label={isPlaying ? COMMON_COPY.pause : COMMON_COPY.play}
            onClick={toggle}
          />
          <Button
            tone="ghost"
            icon="skipNext"
            aria-label={NOW_PLAYING_COPY.nextTrack}
            onClick={skipNext}
          />
          <Button
            tone="ghost"
            icon="reset"
            aria-label={REPEAT_LABELS[queue.repeat]}
            aria-pressed={queue.repeat !== REPEAT_MODES.off}
            onClick={cycleRepeat}
          >
            {queue.repeat === REPEAT_MODES.one ? NOW_PLAYING_COPY.repeatOne : undefined}
          </Button>
          <Button
            tone="ghost"
            icon="list"
            aria-label={COMMON_COPY.addToPlaylist}
            onClick={() => setAdding(true)}
          />
        </div>
        {isAudiobook && <BookControls chapters={chapters} />}
      </div>
      <section className={styles.extras} aria-labelledby={extrasId}>
        <SectionHeading id={extrasId}>{EXTRAS_HEADINGS[extras.key]}</SectionHeading>
        <KeyedView<ExtrasViewProps> key={track.id} views={EXTRAS_VIEWS} view={extras} />
      </section>
      <section className={styles.queue} aria-labelledby={queueId}>
        <SectionHeading
          id={queueId}
          aside={
            <Button tone="quiet" icon="close" onClick={clear}>
              {NOW_PLAYING_COPY.clear}
            </Button>
          }
        >
          {NOW_PLAYING_COPY.queue}
        </SectionHeading>
        <TrackList
          tracks={ordered}
          onPlay={jump}
          currentPlace={queue.at}
          numberOf={({ index }) => index + 1}
          Trail={QueueControls}
          label={NOW_PLAYING_COPY.queue}
        />
      </section>
      {isAdding && <AddToPlaylistDialog tracks={[track]} onClose={() => setAdding(false)} />}
    </section>
  )
}

const NOW_PLAYING_VIEW_KEYS = { empty: 'empty', playing: 'playing' } as const

type NowPlayingViewProps = {
  [NOW_PLAYING_VIEW_KEYS.empty]: Record<never, never>
  [NOW_PLAYING_VIEW_KEYS.playing]: PlayingProps
}

const NOW_PLAYING_VIEWS = {
  [NOW_PLAYING_VIEW_KEYS.empty]: NothingPlaying,
  [NOW_PLAYING_VIEW_KEYS.playing]: Playing,
} as const satisfies ViewsOf<NowPlayingViewProps>

type NowPlayingViewOfProps = { track: Track | null }

/** Which view the page shows: nothing playing, or the track that is. */
const nowPlayingViewOf = ({ track }: NowPlayingViewOfProps): ViewOf<NowPlayingViewProps> => {
  if (track === null) return { key: NOW_PLAYING_VIEW_KEYS.empty, props: {} }
  return { key: NOW_PLAYING_VIEW_KEYS.playing, props: { track } }
}

/**
 * `/now-playing`: the playing track large, with its cover, a scrubber,
 * previous, play or pause, next, shuffle and repeat, then its lyrics, and
 * the queue under them, each track playable, removable or moved up. An
 * audiobook shows its chapters in place of lyrics, with chapter skips and
 * a speed; never Skip intro, though a chapter may be named like one. Empty
 * when nothing plays.
 */
export const NowPlayingPage = () => {
  const track = useAudioQueue(playingTrackOf)
  return (
    <KeyedView<NowPlayingViewProps> views={NOW_PLAYING_VIEWS} view={nowPlayingViewOf({ track })} />
  )
}
