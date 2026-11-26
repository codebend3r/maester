import type { Track } from '@raven/core'
import type { SearchFilter } from '@raven/wren'
import { type Covers, type ResultActions, type SearchResults } from '@raven/wren-native'

import { AlbumTileOf } from '@/components/AlbumTileOf'
import { ArtistTileOf } from '@/components/ArtistTileOf'
import { SongTrackRow } from '@/components/SongTrackRow'
import { SIZE } from '@/theme/tvTokens'
import { TileGrid } from '@/ui/TileGrid'

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

/** What a result drawn from what was found is handed: the covers, and what a press does. */
type FoundProps = Pick<ResultsProps, 'covers' | 'actions'>

type FoundSongProps = FoundProps & {
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

type AlbumGridProps = FoundProps & { albums: SearchResults['albums'] }

/** Albums found, as a grid of tiles: a press opens one, remembering it. */
export function AlbumGrid({ albums, covers, actions }: AlbumGridProps) {
  return (
    <TileGrid
      items={albums}
      keyOf={(album) => album.id}
      renderTile={(album) => (
        <AlbumTileOf album={album} coverOf={covers.coverOf} onOpen={actions.openAlbum} />
      )}
    />
  )
}

type ArtistGridProps = FoundProps & { artists: SearchResults['artists'] }

/** Artists found, as a grid of round tiles: a press opens one's page, remembering it. */
export function ArtistGrid({ artists, covers, actions }: ArtistGridProps) {
  return (
    <TileGrid
      items={artists}
      keyOf={(artist) => artist.id}
      renderTile={(artist) => (
        <ArtistTileOf
          artist={artist}
          line={null}
          onOpen={actions.openArtist}
          photoOf={covers.artistPhotoOf}
          width={SIZE.tileSmall}
        />
      )}
    />
  )
}
