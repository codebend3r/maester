import { type Track, artistNames, formatDuration } from '@raven/core'
import { SONG_LEADS } from '@raven/wren'
import { TrackRow } from '@/components/TrackRow/TrackRow'
import { useCovers } from '@/music/useCovers'
import { artistPath } from '@/routes'
import type { ResultsProps } from '@/screens/Search/ResultParts'
import type { ResultActions } from '@/screens/Search/useResultActions'
import { ArtistRow } from '@/ui/ArtistRow/ArtistRow'
import styles from '@/screens/Search/SearchResults.module.scss'

type FoundSongProps = {
  track: Track
  /** The songs found, which a press plays from this one. */
  tracks: readonly Track[]
  index: number
  actions: ResultActions
  playingId: number | null
}

/** A song found: a press plays the songs found from it, remembering what was searched for. */
export function FoundSong({ track, tracks, index, actions, playingId }: FoundSongProps) {
  const { trackCoverOf } = useCovers()
  return (
    <li className={styles.row}>
      <TrackRow
        isCurrent={track.id === playingId}
        label={track.title}
        lead={{ kind: SONG_LEADS.art, cover: trackCoverOf(track) }}
        length={formatDuration(track.duration)}
        onPress={() => actions.playSongs({ tracks, startAt: index })}
        subtitle={artistNames(track)}
        track={track}
      />
    </li>
  )
}

type ArtistRowsProps = Pick<ResultsProps, 'results' | 'actions'>

/** The artists found, a row each. */
export function ArtistRows({ results, actions }: ArtistRowsProps) {
  const { artistPhotoOf } = useCovers()
  return (
    <ul className={styles.rows}>
      {results.artists.map((artist) => (
        <li className={styles.row} key={artist.id}>
          <ArtistRow
            albumCount={artist.albumCount}
            href={artistPath(artist.id)}
            name={artist.name}
            onPress={() => actions.rememberArtist(artist)}
            picture={artistPhotoOf(artist)}
            trackCount={artist.trackCount}
          />
        </li>
      ))}
    </ul>
  )
}
