import {
  ALBUMS_IN_ALL,
  FILTER_LABELS,
  KIT_COPY,
  LIBRARY_COPY,
  RESULT_STATES,
  type ResultState,
  SEARCH_COPY,
  SEARCH_FILTERS,
  SONGS_IN_ALL,
  type SearchFilter,
  topResultOf,
} from '@raven/wren'
import type { ComponentType, ReactNode } from 'react'
import { FlatList, ScrollView, View } from 'react-native'

import { AlbumTileOf } from '@/components/AlbumTileOf'
import { FoundArtist, FoundSong, type ResultsProps } from '@/screens/search/parts'
import { TopResultCard } from '@/screens/search/TopResult'
import { SPACE } from '@/theme/tvTokens'
import { usePageStyles } from '@/ui/pageStyles'
import { themedStyles } from '@/theme/wrenTheme'
import { EmptyState } from '@/ui/EmptyState'
import { SectionHeader } from '@/ui/Headers'
import { Loading } from '@/ui/Loading'
import { TileGrid } from '@/ui/TileGrid'
import { ICONS } from '@/ui/WrenIcon'

const useStyles = themedStyles(() => ({
  scroller: { flex: 1 },
  content: { gap: SPACE.s6, paddingBottom: SPACE.gutter },
  rows: { gap: SPACE.s1 },
}))

/** All's songs on the TV, the tablet's count: See all opens the rest. */
const SONGS_SHOWN = SONGS_IN_ALL.tablet

type ResultSectionProps = Pick<ResultsProps, 'onFilter'> & {
  /** The kind this section shows the start of: its title, and what See all narrows to. */
  filter: SearchFilter
  /** How many of that kind were found; none, and the section is not drawn. */
  count: number
  children: ReactNode
}

/** One kind of result in All: its title, See all, and the start of what was found. */
function ResultSection({ filter, count, onFilter, children }: ResultSectionProps) {
  const page = usePageStyles()
  return (
    count > 0 && (
      <View style={page.section}>
        <SectionHeader
          action={{
            text: KIT_COPY.seeAll,
            label: KIT_COPY.seeAllOf(FILTER_LABELS[filter]),
            onPress: () => onFilter(filter),
          }}
          title={FILTER_LABELS[filter]}
        />
        {children}
      </View>
    )
  )
}

/** Everything a search found: the top result, then the start of each kind in turn. */
function AllResults({ results, query, onFilter, covers, actions }: ResultsProps) {
  const styles = useStyles()
  const { albums, artists, songs } = results
  const top = topResultOf({ query, albums, artists, songs })
  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.scroller}>
      {top !== null && (
        <TopResultCard actions={actions} covers={covers} result={top} songs={songs} />
      )}
      <ResultSection count={songs.length} filter={SEARCH_FILTERS.songs} onFilter={onFilter}>
        <View style={styles.rows}>
          {songs.slice(0, SONGS_SHOWN).map((track, index) => (
            <FoundSong
              actions={actions}
              covers={covers}
              index={index}
              key={track.id}
              track={track}
              tracks={songs}
            />
          ))}
        </View>
      </ResultSection>
      <ResultSection count={albums.length} filter={SEARCH_FILTERS.albums} onFilter={onFilter}>
        <TileGrid
          items={albums.slice(0, ALBUMS_IN_ALL)}
          keyOf={(album) => album.id}
          renderTile={(album) => (
            <AlbumTileOf album={album} coverOf={covers.coverOf} onOpen={actions.openAlbum} />
          )}
        />
      </ResultSection>
      <ResultSection count={artists.length} filter={SEARCH_FILTERS.artists} onFilter={onFilter}>
        <TileGrid
          items={artists}
          keyOf={(artist) => artist.id}
          renderTile={(artist) => <FoundArtist actions={actions} artist={artist} covers={covers} />}
        />
      </ResultSection>
    </ScrollView>
  )
}

/** Nothing matched, the whole search or the kind a filter narrowed it to, with a way to clear it. */
function NoMatches({ query, onClear }: ResultsProps) {
  return (
    <EmptyState
      action={{ text: SEARCH_COPY.clearSearch, onPress: onClear }}
      body={SEARCH_COPY.noMatchesHint}
      icon={ICONS.search}
      title={SEARCH_COPY.noMatches(query)}
    />
  )
}

/** Every song found, a page at a time, the next asked for near the end. */
function SongResults(props: ResultsProps) {
  const { results, covers, actions } = props
  const styles = useStyles()
  return (
    <FlatList
      ListEmptyComponent={<NoMatches {...props} />}
      contentContainerStyle={[styles.rows, styles.content]}
      data={results.songs}
      keyExtractor={(track, index) => `${track.id}:${index}`}
      onEndReached={results.nextSongs}
      renderItem={({ item, index }) => (
        <FoundSong
          actions={actions}
          covers={covers}
          index={index}
          track={item}
          tracks={results.songs}
        />
      )}
      style={styles.scroller}
    />
  )
}

/** Every album found, as a grid of tiles. */
function AlbumResults(props: ResultsProps) {
  const { results, covers, actions } = props
  const styles = useStyles()
  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.scroller}>
      {results.albums.length === 0 && <NoMatches {...props} />}
      <TileGrid
        items={results.albums}
        keyOf={(album) => album.id}
        renderTile={(album) => (
          <AlbumTileOf album={album} coverOf={covers.coverOf} onOpen={actions.openAlbum} />
        )}
      />
    </ScrollView>
  )
}

/** Every artist found, as a grid of round tiles. */
function ArtistResults(props: ResultsProps) {
  const { results, covers, actions } = props
  const styles = useStyles()
  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.scroller}>
      {results.artists.length === 0 && <NoMatches {...props} />}
      <TileGrid
        items={results.artists}
        keyOf={(artist) => artist.id}
        renderTile={(artist) => <FoundArtist actions={actions} artist={artist} covers={covers} />}
      />
    </ScrollView>
  )
}

const FILTER_VIEWS = {
  [SEARCH_FILTERS.all]: AllResults,
  [SEARCH_FILTERS.songs]: SongResults,
  [SEARCH_FILTERS.albums]: AlbumResults,
  [SEARCH_FILTERS.artists]: ArtistResults,
} as const satisfies Record<SearchFilter, ComponentType<ResultsProps>>

/** What a search found, as the chosen filter narrows it. */
function FilterResults(props: ResultsProps) {
  const FilterView = FILTER_VIEWS[props.filter]
  return <FilterView {...props} />
}

function Failed({ results }: ResultsProps) {
  return (
    <EmptyState
      body={SEARCH_COPY.failedHint(results.failure?.message ?? '')}
      icon={ICONS.alert}
      title={SEARCH_COPY.failed}
    />
  )
}

function NoMusic() {
  return (
    <EmptyState body={SEARCH_COPY.noMusicHint} icon={ICONS.album} title={LIBRARY_COPY.noMusic} />
  )
}

const STATE_VIEWS = {
  [RESULT_STATES.noMusic]: NoMusic,
  [RESULT_STATES.failed]: Failed,
  [RESULT_STATES.searching]: Loading,
  [RESULT_STATES.empty]: NoMatches,
  [RESULT_STATES.found]: FilterResults,
} as const satisfies Record<ResultState, ComponentType<ResultsProps>>

/** A search's results, or why there are none, under the field and the filters. */
export function Results(props: ResultsProps) {
  const StateView = STATE_VIEWS[props.results.state]
  return <StateView {...props} />
}
