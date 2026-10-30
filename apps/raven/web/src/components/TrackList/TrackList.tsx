import { Button, Icon } from '@raven/ui'
import type { Track } from '@raven/core'
import { AUDIO_STATES, playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import type { ComponentType, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { TRACK_LIST_COPY } from '@/components/TrackList/copy'
import { artistPath, trackLength } from '@/lib/music'
import styles from '@/components/TrackList/TrackList.module.scss'
import { COMMON_COPY } from '@/lib/copy'

/** What a row's leading cell shows: a speaker while its track plays, else its number. */
const LEAD_KINDS = { speaker: 'speaker', number: 'number' } as const
type LeadKind = (typeof LEAD_KINDS)[keyof typeof LEAD_KINDS]

type LeadProps = { number: number | null }

const Speaker = () => <Icon name="volume" size="1em" />

type TrackNumberProps = LeadProps

const TrackNumber = ({ number }: TrackNumberProps) => number ?? ''

const LEADS = {
  [LEAD_KINDS.speaker]: Speaker,
  [LEAD_KINDS.number]: TrackNumber,
} as const satisfies Record<LeadKind, ComponentType<LeadProps>>

type TrackRowProps = {
  track: Track
  /** What the row's leading cell shows: the track's number on its disc, or its place in a queue. */
  number: number | null
  isPlaying: boolean
  isPaused: boolean
  onPlay: () => void
  /** The row's own controls at its end, after the length. */
  trail: ReactNode
  /** Whether the row names the artists, which an album by one artist need not. */
  shouldShowArtists: boolean
}

const TrackRow = ({
  track,
  number,
  isPlaying,
  isPaused,
  onPlay,
  trail,
  shouldShowArtists,
}: TrackRowProps) => {
  const Lead = LEADS[isPlaying ? LEAD_KINDS.speaker : LEAD_KINDS.number]
  return (
    <li
      className={isPlaying || isPaused ? `${styles.row} ${styles.current}` : styles.row}
      aria-current={isPlaying || isPaused ? 'true' : undefined}
    >
      <span className={styles.number} aria-hidden="true">
        <Lead number={number} />
      </span>
      <Button
        tone="ghost"
        className={styles.play}
        icon={isPlaying ? 'pause' : 'play'}
        aria-label={
          isPlaying ? TRACK_LIST_COPY.pause(track.title) : TRACK_LIST_COPY.play(track.title)
        }
        onClick={onPlay}
      />
      <span className={styles.title}>
        <span className={styles.name}>{track.title}</span>
        {shouldShowArtists && (
          <span className={styles.artists}>
            {track.artists.map((artist, index) => (
              <span key={artist.id}>
                {index > 0 && COMMON_COPY.listSeparator}
                <Link to={artistPath(artist.id)}>{artist.name}</Link>
              </span>
            ))}
          </span>
        )}
      </span>
      <span className={styles.length}>{trackLength(track.duration)}</span>
      {trail && <span className={styles.trail}>{trail}</span>}
    </li>
  )
}

/** What a row's controls are told: the track and its place in the list. */
export type TrailProps = { track: Track; index: number }

type TrackListProps = {
  tracks: readonly Track[]
  /** Plays the track at `index` among `tracks`: an album starts its queue there, a queue jumps. */
  onPlay: (index: number) => void
  /** The number each row shows; the track's own number when left out. */
  numberOf?: (props: TrailProps) => number | null
  /**
   * Which row is the playing one, by place: the queue, where a track can
   * be listed twice. Left out, the row whose track is playing is.
   */
  currentPlace?: number | null
  /** Controls at the end of each row, given the track and its place. */
  Trail?: (props: TrailProps) => ReactNode
  /** Whether every row names its artists; on by default, off for an album by one artist. */
  shouldShowArtists?: boolean
  label: string
}

/**
 * Tracks as a list: a number or a speaker for the one playing, a play
 * button, the title (and artists), the length, and any controls of the
 * row's own. The row that plays is marked, and its button pauses.
 */
export const TrackList = ({
  tracks,
  onPlay,
  numberOf = ({ track }) => track.number,
  Trail,
  currentPlace,
  shouldShowArtists = true,
  label,
}: TrackListProps) => {
  const playing = useAudioQueue(playingTrackOf)
  const state = useAudioQueue((store) => store.state)
  const toggle = useAudioQueue((store) => store.toggle)
  return (
    <ol className={styles.list} aria-label={label}>
      {tracks.map((track, index) => {
        const isCurrent =
          currentPlace === undefined ? (playing?.id ?? null) === track.id : index === currentPlace
        const isPlaying =
          isCurrent && (state === AUDIO_STATES.playing || state === AUDIO_STATES.loading)
        return (
          <TrackRow
            key={`${track.id}-${index}`}
            track={track}
            number={numberOf({ track, index })}
            isPlaying={isPlaying}
            isPaused={isCurrent && state === AUDIO_STATES.paused}
            onPlay={() => (isCurrent ? toggle() : onPlay(index))}
            trail={Trail !== undefined && <Trail track={track} index={index} />}
            shouldShowArtists={shouldShowArtists}
          />
        )
      })}
    </ol>
  )
}
