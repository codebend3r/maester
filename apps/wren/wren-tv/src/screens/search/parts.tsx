import type { Artist, Track } from '@raven/core'
import type { SearchFilter } from '@raven/wren'

import { SongTrackRow } from '@/components/SongTrackRow'
import { type Covers, type ResultActions, type SearchResults } from '@raven/wren-native'
import { SIZE } from '@/theme/tvTokens'
import { ArtistTileOf } from '@/components/ArtistTileOf'

/** What every view of a search's results is handed. */
export type ResultsProps = {
  results: SearchResults
  query: string
  filter: SearchFilter
  onFilter: (filter: SearchFilter) => void
  onClear: () => void
  covers: Covers
  actions: ResultActions
}

type FoundSongProps = Pick<ResultsProps, 'covers' | 'actions'> & {
  track: Track
  /** The songs found, which a press plays from this one. */
  tracks: readonly Track[]
  index: number
}

/**
 * A song found, as every list of songs outside its album draws one: its cover, title, artists
 * and length, marked while it plays. A press plays the songs found from it.
 */
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

/** An artist found, as a round tile: a press opens its page, remembering it. */
export function FoundArtist({ artist, covers, actions }: FoundArtistProps) {
  return (
    <ArtistTileOf
      artist={artist}
      line={null}
      onOpen={actions.openArtist}
      photoOf={covers.artistPhotoOf}
      width={SIZE.tileSmall}
    />
  )
}
