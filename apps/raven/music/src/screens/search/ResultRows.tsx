import { type Artist, type Track, artistNames, formatDuration } from '@raven/core'
import { SONG_LEADS } from '@raven/wren'

import { TrackRow } from '@/components/TrackRow'
import type { ResultsProps } from '@/screens/search/ResultParts'
import { ArtistRow } from '@/ui/ArtistRow'

type FoundSongProps = Pick<ResultsProps, 'covers' | 'actions'> & {
  track: Track
  /** The songs found, which a press plays from this one. */
  tracks: readonly Track[]
  index: number
  playingId: number | null
}

/** A song found: a press plays the songs found from it, remembering what was searched for. */
export function FoundSong({ track, tracks, index, covers, actions, playingId }: FoundSongProps) {
  return (
    <TrackRow
      isCurrent={track.id === playingId}
      label={track.title}
      lead={{ kind: SONG_LEADS.art, cover: covers.trackCoverOf(track) }}
      length={formatDuration(track.duration)}
      onPress={() => actions.playSongs({ tracks, startAt: index })}
      subtitle={artistNames(track)}
      track={track}
    />
  )
}

type FoundArtistProps = Pick<ResultsProps, 'covers' | 'actions'> & { artist: Artist }

/** An artist found: a press opens its page, remembering it among the recent searches. */
export function FoundArtist({ artist, covers, actions }: FoundArtistProps) {
  return (
    <ArtistRow
      albumCount={artist.albumCount}
      name={artist.name}
      onPress={() => actions.openArtist(artist)}
      picture={covers.artistPhotoOf(artist)}
      trackCount={artist.trackCount}
    />
  )
}
