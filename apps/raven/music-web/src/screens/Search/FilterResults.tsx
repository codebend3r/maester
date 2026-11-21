import { SEARCH_FILTERS, type SearchFilter } from '@raven/wren'
import { playingIdOf, useAudioQueue } from '@raven/ui/headless'
import type { ComponentType } from 'react'
import { AlbumGrid } from '@/components/AlbumGrid/AlbumGrid'
import { AllResults } from '@/screens/Search/AllResults'
import { ALBUM_COLUMNS, NoMatches, type ResultsProps } from '@/screens/Search/ResultParts'
import { ArtistRows, FoundSong } from '@/screens/Search/ResultRows'
import { useEndReached } from '@/ui/useEndReached'
import styles from '@/screens/Search/SearchResults.module.scss'

/** Every song found, a page at a time, the next asked for near the end. */
function SongResults(props: ResultsProps) {
  const { results, actions } = props
  const playingId = useAudioQueue(playingIdOf)
  const end = useEndReached({ onEndReached: results.nextSongs, count: results.songs.length })
  return (
    <>
      {results.songs.length === 0 && <NoMatches {...props} />}
      <ul className={styles.rows}>
        {results.songs.map((track, index) => (
          <FoundSong
            actions={actions}
            index={index}
            key={`${track.id}:${index}`}
            playingId={playingId}
            track={track}
            tracks={results.songs}
          />
        ))}
      </ul>
      <div aria-hidden="true" className={styles.end} ref={end} />
    </>
  )
}

/** Every album found, as a grid of tiles. */
function AlbumResults(props: ResultsProps) {
  const { results, actions } = props
  return (
    <>
      {results.albums.length === 0 && <NoMatches {...props} />}
      <AlbumGrid albums={results.albums} columns={ALBUM_COLUMNS} onOpen={actions.rememberAlbum} />
    </>
  )
}

/** Every artist found, a row each. */
function ArtistResults(props: ResultsProps) {
  return (
    <>
      {props.results.artists.length === 0 && <NoMatches {...props} />}
      <ArtistRows actions={props.actions} results={props.results} />
    </>
  )
}

const FILTER_VIEWS = {
  [SEARCH_FILTERS.all]: AllResults,
  [SEARCH_FILTERS.songs]: SongResults,
  [SEARCH_FILTERS.albums]: AlbumResults,
  [SEARCH_FILTERS.artists]: ArtistResults,
} as const satisfies Record<SearchFilter, ComponentType<ResultsProps>>

/** What a search found, as the chosen chip narrows it. */
export function FilterResults(props: ResultsProps) {
  const FilterView = FILTER_VIEWS[props.filter]
  return <FilterView {...props} />
}
