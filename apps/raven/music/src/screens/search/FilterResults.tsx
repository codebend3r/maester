import { SEARCH_FILTERS, type SearchFilter } from '@raven/wren'
import { playingIdOf, useAudioQueue } from '@raven/ui/headless'
import type { ComponentType } from 'react'
import { FlatList, View } from 'react-native'

import { AllResults } from '@/screens/search/AllResults'
import { ALBUM_COLUMNS, NoMatches, type ResultsProps } from '@/screens/search/ResultParts'
import { FoundArtist, FoundSong } from '@/screens/search/ResultRows'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'
import { AlbumTileOf } from '@/ui/AlbumTile'
import { GRID_GAP, useGrid } from '@/ui/TileGrid'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  scroller: { backgroundColor: colors.bg, flex: 1 },
  gridRow: { gap: GRID_GAP },
  gridGap: { height: SPACE.s5 },
}))

/** Every song found, a page at a time, the next asked for near the end. */
function SongResults(props: ResultsProps) {
  const { results, covers, actions, contentStyle } = props
  const styles = useStyles()
  const playingId = useAudioQueue(playingIdOf)
  return (
    <FlatList
      ListEmptyComponent={<NoMatches {...props} contentStyle={null} />}
      contentContainerStyle={contentStyle}
      data={results.songs}
      keyExtractor={(track, index) => `${track.id}:${index}`}
      keyboardShouldPersistTaps="handled"
      onEndReached={results.nextSongs}
      renderItem={({ item, index }) => (
        <FoundSong
          actions={actions}
          covers={covers}
          index={index}
          playingId={playingId}
          track={item}
          tracks={results.songs}
        />
      )}
      style={styles.scroller}
    />
  )
}

/** The room between two rows of album tiles. */
function GridGap() {
  const styles = useStyles()
  return <View style={styles.gridGap} />
}

/** Every album found, as a grid of tiles. */
function AlbumResults(props: ResultsProps) {
  const { results, covers, actions, contentStyle } = props
  const styles = useStyles()
  const { columns, tileWidth, onLayout } = useGrid({ columns: ALBUM_COLUMNS })
  return (
    <FlatList
      ListEmptyComponent={<NoMatches {...props} contentStyle={null} />}
      ItemSeparatorComponent={GridGap}
      columnWrapperStyle={styles.gridRow}
      contentContainerStyle={contentStyle}
      data={results.albums}
      key={columns}
      keyExtractor={(album) => String(album.id)}
      keyboardShouldPersistTaps="handled"
      numColumns={columns}
      onLayout={onLayout}
      renderItem={({ item }) => (
        <AlbumTileOf
          album={item}
          coverOf={covers.coverOf}
          onPress={actions.openAlbum}
          width={tileWidth}
        />
      )}
      style={styles.scroller}
    />
  )
}

/** Every artist found, a row each. */
function ArtistResults(props: ResultsProps) {
  const { results, covers, actions, contentStyle } = props
  const styles = useStyles()
  return (
    <FlatList
      ListEmptyComponent={<NoMatches {...props} contentStyle={null} />}
      contentContainerStyle={contentStyle}
      data={results.artists}
      keyExtractor={(artist) => String(artist.id)}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => <FoundArtist actions={actions} artist={item} covers={covers} />}
      style={styles.scroller}
    />
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
