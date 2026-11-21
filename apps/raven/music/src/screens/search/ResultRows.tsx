import type { Artist, Track } from '@raven/core'

import { SongTrackRow } from '@/components/SongTrackRow'
import type { ResultsProps } from '@/screens/search/ResultParts'
import { ArtistRow } from '@/ui/ArtistRow'

type FoundSongProps = Pick<ResultsProps, 'covers' | 'actions'> & {
  track: Track
  /** The songs found, which a press plays from this one. */
  tracks: readonly Track[]
  index: number
}

/** A song found: a press plays the songs found from it, remembering what was searched for. */
export function FoundSong({ track, tracks, index, covers, actions }: FoundSongProps) {
  return (
    <SongTrackRow
      cover={covers.trackCoverOf(track)}
      onPress={() => actions.playSongs({ tracks, startAt: index })}
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
