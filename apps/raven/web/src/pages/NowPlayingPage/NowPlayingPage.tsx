import {
  type Chapter,
  REPEAT_MODES,
  type Track,
  formatDuration,
  orderedOf,
  remainingTimeOf,
  nextChapterStart,
  previousChapterStart,
} from '@raven/core'
import { BUTTON_TONES, Button, classNames, repeatIconOf } from '@raven/ui'
import {
  AUDIOBOOK_SPEEDS,
  AUDIO_STATES,
  playingTrackOf,
  useAudioQueue,
  useAudiobookChapters,
  usePlayerPrefs,
  KeyedView,
  type ViewOf,
  type ViewsOf,
} from '@raven/ui/headless'
import { type ComponentType, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AudioQualityLine } from '@/components/AudioQualityLine/AudioQualityLine'
import { AddToPlaylistDialog } from '@/components/AddToPlaylistDialog/AddToPlaylistDialog'
import { Equalizer } from '@/components/Equalizer/Equalizer'
import { AlbumCover } from '@/components/AlbumCover/AlbumCover'
import { BackButton } from '@/components/BackButton/BackButton'
import { Tabs } from '@/components/Tabs/Tabs'
import { TrackHeart } from '@/components/TrackHeart/TrackHeart'
import { Transport } from '@/components/Transport/Transport'
import { VolumeControl } from '@/components/VolumeControl/VolumeControl'
import { TrackList, type TrailProps } from '@/components/TrackList/TrackList'
import { api } from '@/lib/api'
import { PANE_COPY, PANE_PARAM, PANES, type Pane, paneOf } from '@/lib/nowPlayingPanes'
import { useAudioQuality } from '@/lib/useAudioQuality'
import { useMusicLinks } from '@/lib/useMusicLinks'
import { POSTER_SIZES } from '@/lib/posters'
import { ChaptersPanel } from '@/pages/NowPlayingPage/ChaptersPanel'
import { LyricsPanel } from '@/pages/NowPlayingPage/LyricsPanel'
import { NOW_PLAYING_COPY, REPEAT_COPY } from '@/pages/NowPlayingPage/copy'
import styles from '@/pages/NowPlayingPage/NowPlayingPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type QueueControlsProps = TrailProps

/** A queued row's controls: up one place, and out of the queue. */
const QueueControls = ({ index }: QueueControlsProps) => {
  const move = useAudioQueue((store) => store.move)
  const remove = useAudioQueue((store) => store.remove)
  return (
    <>
      <Button
        tone={BUTTON_TONES.ghost}
        icon="up"
        aria-label={NOW_PLAYING_COPY.moveUp}
        disabled={index === 0}
        onClick={() => move({ from: index, to: index - 1 })}
      />
      <Button
        tone={BUTTON_TONES.ghost}
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
        tone={BUTTON_TONES.ghost}
        icon="rewind"
        aria-label={NOW_PLAYING_COPY.previousChapter}
        disabled={!hasChapters}
        onClick={() => seekTo(previousChapterStart({ chapters, at: positionNow() }))}
      />
      <Button
        tone={BUTTON_TONES.ghost}
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
  [EXTRAS_VIEW_KEYS.chapters]: PANE_COPY.chapters,
  [EXTRAS_VIEW_KEYS.lyrics]: PANE_COPY.lyrics,
} as const satisfies Record<keyof ExtrasViewProps, string>

type ExtrasViewOfProps = { track: Track; isAudiobook: boolean; chapters: readonly Chapter[] }

/** What the second tab holds: an audiobook's chapters, or a song's lyrics. */
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
  const links = useMusicLinks()
  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <BackButton fallback={links.home} className={styles.back} />
      <h1 id={titleId} className={styles.title}>
        {NOW_PLAYING_COPY.title}
      </h1>
      <p className={styles.empty}>{NOW_PLAYING_COPY.empty}</p>
    </section>
  )
}

type PaneProps = { track: Track; extras: ViewOf<ExtrasViewProps> }

/*
 * The queue's pane: how much is queued, the modes that change what plays next (shuffle, repeat)
 * and Clear, over the queue itself, each track playable, removable or moved up.
 */
const QueuePane = () => {
  const queue = useAudioQueue((store) => store.queue)
  const tracks = useAudioQueue((store) => store.tracks)
  const jump = useAudioQueue((store) => store.jump)
  const toggleShuffle = useAudioQueue((store) => store.toggleShuffle)
  const cycleRepeat = useAudioQueue((store) => store.cycleRepeat)
  const clear = useAudioQueue((store) => store.clear)
  const ordered = orderedOf(queue).flatMap(({ id }) => {
    const queued = tracks[id]
    return queued === undefined ? [] : [queued]
  })
  const seconds = ordered.reduce((total, queued) => total + (queued.duration ?? 0), 0)
  return (
    <div className={styles.queue}>
      <div className={styles.queueHead}>
        <p className={styles.queueFacts}>
          {NOW_PLAYING_COPY.queueFacts({ count: ordered.length, length: formatDuration(seconds) })}
        </p>
        <div className={styles.modes}>
          <Button
            tone={BUTTON_TONES.ghost}
            icon="shuffle"
            aria-label={queue.isShuffled ? NOW_PLAYING_COPY.shuffleOn : NOW_PLAYING_COPY.shuffleOff}
            aria-pressed={queue.isShuffled}
            onClick={toggleShuffle}
          />
          <Button
            tone={BUTTON_TONES.ghost}
            icon={repeatIconOf(queue.repeat)}
            aria-label={REPEAT_COPY[queue.repeat]}
            aria-pressed={queue.repeat !== REPEAT_MODES.off}
            onClick={cycleRepeat}
          />
          <Button tone={BUTTON_TONES.quiet} icon="close" onClick={clear}>
            {NOW_PLAYING_COPY.clear}
          </Button>
        </div>
      </div>
      <TrackList
        tracks={ordered}
        onPlay={jump}
        currentPlace={queue.at}
        numberOf={({ index }) => index + 1}
        Trail={QueueControls}
        shouldShowAlbumCovers
        label={NOW_PLAYING_COPY.queue}
      />
    </div>
  )
}

/** The other pane: a song's lyrics, or an audiobook's chapters. */
const ExtrasPane = ({ track, extras }: PaneProps) => (
  <KeyedView<ExtrasViewProps> key={track.id} views={EXTRAS_VIEWS} view={extras} />
)

const PANE_VIEWS = {
  [PANES.queue]: QueuePane,
  [PANES.extras]: ExtrasPane,
} as const satisfies Record<Pane, ComponentType<PaneProps>>

type PlayingProps = { track: Track }

/**
 * The page while `track` plays. The player: the cover, the track with its heart and Add to
 * playlist beside its name, the format and quality it plays in, the scrubber with the time
 * left, previous, play or pause and next alone in their row, then the volume. Beside it on a wide window, under it on a narrow one, a
 * pane of two tabs: Up next (the queue, under its shuffle, repeat and Clear) and the lyrics, or
 * an audiobook's chapters. The address names the tab, so the mini-player opens either.
 */
const Playing = ({ track }: PlayingProps) => {
  const titleId = useId()
  const links = useMusicLinks()
  const { isAudiobook, chapters } = useAudiobookChapters({ api, track })
  const [isAdding, setAdding] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const queued = useAudioQueue((store) => store.queue.items.length)
  const state = useAudioQueue((store) => store.state)
  const position = useAudioQueue((store) => store.position)
  const duration = useAudioQueue((store) => store.duration)
  const error = useAudioQueue((store) => store.error)
  const seekTo = useAudioQueue((store) => store.seekTo)
  const quality = useAudioQuality({ track })

  const length = duration ?? track.duration ?? 0
  const pane = paneOf(searchParams.get(PANE_PARAM))
  const PaneView = PANE_VIEWS[pane]
  const extras = extrasViewOf({ track, isAudiobook, chapters })

  return (
    <section className={styles.playing} aria-labelledby={titleId}>
      <BackButton fallback={links.home} className={styles.back} />
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
          <div className={styles.heading}>
            <h2 className={styles.trackTitle}>{track.title}</h2>
            <Equalizer isPlaying={state === AUDIO_STATES.playing} />
          </div>
          <p className={styles.artists}>
            {track.artists.map((artist, index) => (
              <span key={artist.id}>
                {index > 0 && COMMON_COPY.listSeparator}
                <Link to={links.artist(artist.id)}>{artist.name}</Link>
              </span>
            ))}
          </p>
          <p className={styles.album}>
            <Link to={links.album(track.albumId)}>{track.album.title}</Link>
          </p>
          {error !== null && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
        <div className={styles.actions}>
          <TrackHeart track={track} />
          <Button
            tone={BUTTON_TONES.ghost}
            icon="plus"
            aria-label={COMMON_COPY.addToPlaylist}
            onClick={() => setAdding(true)}
          />
        </div>
        {quality !== null && <AudioQualityLine quality={quality} className={styles.quality} />}
        <div className={styles.scrubber}>
          <span className={classNames([styles.time, styles.played])}>
            {formatDuration(position)}
          </span>
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
          <span className={classNames([styles.time, styles.left])}>
            {remainingTimeOf({ position, length })}
          </span>
        </div>
        <Transport className={styles.controls} playSize="large" />
        <VolumeControl className={styles.volume} />
        {isAudiobook && <BookControls chapters={chapters} />}
      </div>
      <div className={styles.context}>
        <Tabs
          label={NOW_PLAYING_COPY.panes}
          tabs={[
            { value: PANES.queue, label: PANE_COPY.upNext, count: queued },
            { value: PANES.extras, label: EXTRAS_HEADINGS[extras.key] },
          ]}
          chosen={pane}
          onChoose={(chosen) => setSearchParams({ [PANE_PARAM]: chosen }, { replace: true })}
        >
          <PaneView track={track} extras={extras} />
        </Tabs>
      </div>
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
 * `/now-playing`: the playing track large, with its cover, its heart and Add to playlist, a
 * scrubber, previous, play or pause and next, and the volume; beside it a pane of two tabs, Up
 * next (the queue under its shuffle, repeat and Clear, each track playable, removable or moved
 * up) and the lyrics. An audiobook shows its chapters in place of lyrics, with chapter skips and
 * a speed; never Skip intro, though a chapter may be named like one. Empty when nothing plays.
 */
export const NowPlayingPage = () => {
  const track = useAudioQueue(playingTrackOf)
  return (
    <KeyedView<NowPlayingViewProps> views={NOW_PLAYING_VIEWS} view={nowPlayingViewOf({ track })} />
  )
}
