import { type Track, artistNames, formatDuration } from '@raven/core'
import { playingIdOf, useAudioQueue } from '@raven/ui/headless'
import { SONG_LEADS } from '@raven/wren'
import { PlayButtons } from '@/components/PlayButtons/PlayButtons'
import { TrackRow } from '@/components/TrackRow/TrackRow'
import { useCovers } from '@/music/useCovers'
import styles from '@/screens/Collection/TrackList.module.scss'

type TrackListProps = { tracks: readonly Track[] }

/** Play and Shuffle over a list of songs, sharing the width they are given. */
export function TrackActions({ tracks }: TrackListProps) {
  const playTracks = useAudioQueue((store) => store.playTracks)
  return (
    <div className={styles.actions}>
      <PlayButtons
        onPlay={() => playTracks({ tracks })}
        onShuffle={() => playTracks({ tracks, isShuffled: true })}
      />
    </div>
  )
}

/** A row for each song, with its cover and its artists, which plays the list from there. */
export function TrackList({ tracks }: TrackListProps) {
  const { trackCoverOf } = useCovers()
  const playTracks = useAudioQueue((store) => store.playTracks)
  const playingId = useAudioQueue(playingIdOf)
  return (
    <ul className={styles.list}>
      {tracks.map((track, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- a page read while the library changes can repeat a song, as the apps' list keys allow
        <li className={styles.row} key={`${track.id}:${index}`}>
          <TrackRow
            isCurrent={track.id === playingId}
            label={track.title}
            lead={{ kind: SONG_LEADS.art, cover: trackCoverOf(track) }}
            length={formatDuration(track.duration)}
            onPress={() => playTracks({ tracks, startAt: index })}
            subtitle={artistNames(track)}
            track={track}
          />
        </li>
      ))}
    </ul>
  )
}
