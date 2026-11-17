import { type Track, artistNames, formatDuration } from '@raven/core'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import type { ComponentType } from 'react'
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native'

import { TrackRow } from '@/components/TrackRow'
import { LIBRARY_COPY } from '@/music/musicLibraries'
import type { Covers } from '@/music/useCovers'
import { SEARCH_COPY } from '@/screens/copy'
import { ArtistCircles, TopResultCard } from '@/screens/search/ResultParts'
import { topResultOf } from '@/screens/search/topResult'
import type { ResultActions } from '@/screens/search/useResultActions'
import {
  RESULT_STATES,
  type ResultState,
  type SearchResults as Results,
} from '@/screens/search/useSearchResults'
import { type WrenTheme, themedStyles, useFormFactor, useWrenTheme } from '@/theme/wrenTheme'
import { SPACE, FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { AlbumTileOf } from '@/ui/AlbumTile'
import { ArtistRow } from '@/ui/ArtistRow'
import { BUTTON_VARIANTS } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { SectionHeader } from '@/ui/SectionHeader'
import { Shelf } from '@/ui/Shelf'
import { GRID_COLUMNS, GRID_GAP, type GridColumns, TileGrid, useGrid } from '@/ui/TileGrid'
import { SONG_LEADS } from '@/ui/songLead'
import { ICONS } from '@/ui/WrenIcon'

/** What the chips narrow the results to. */
export const SEARCH_FILTERS = {
  all: 'all',
  songs: 'songs',
  albums: 'albums',
  artists: 'artists',
} as const

export type SearchFilter = (typeof SEARCH_FILTERS)[keyof typeof SEARCH_FILTERS]

/** The chips, in the order they show. */
export const FILTER_CHIPS = [
  { key: SEARCH_FILTERS.all, label: SEARCH_COPY.all },
  { key: SEARCH_FILTERS.songs, label: SEARCH_COPY.songs },
  { key: SEARCH_FILTERS.albums, label: SEARCH_COPY.albums },
  { key: SEARCH_FILTERS.artists, label: SEARCH_COPY.artists },
] as const

// All shows the start of the songs; See all opens the rest, a page at a time.
const SONGS_IN_ALL = {
  [FORM_FACTORS.phone]: 8,
  [FORM_FACTORS.tablet]: 6,
} as const satisfies Record<FormFactor, number>

// All's albums on a tablet: two rows of four.
const TABLET_ALBUMS_IN_ALL = 8

// Album tiles to a row under the Albums chip, and in a tablet's All.
const ALBUM_COLUMNS = {
  [FORM_FACTORS.phone]: GRID_COLUMNS[FORM_FACTORS.phone],
  [FORM_FACTORS.tablet]: 4,
} as const satisfies GridColumns

// A tablet's All: the songs and albums take this share of the width, the artists the rest.
const TABLET_MAIN_SHARE = 1.4 / 2.4

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  scroller: { backgroundColor: colors.bg, flex: 1 },
  sections: { gap: SPACE.s6 },
  section: { gap: SPACE.s3 },
  columns: { flexDirection: 'row', gap: SPACE.s8 },
  main: { flex: TABLET_MAIN_SHARE, gap: SPACE.s6 },
  side: { flex: 1 - TABLET_MAIN_SHARE },
  gridRow: { gap: GRID_GAP },
  gridGap: { height: SPACE.s5 },
  searching: { paddingVertical: SPACE.s8 },
}))

export type ResultsProps = {
  results: Results
  query: string
  filter: SearchFilter
  onFilter: (filter: SearchFilter) => void
  onClear: () => void
  covers: Covers
  actions: ResultActions
  /** The width inside the page's padding. */
  width: number
  /** The scroller's padding, clear of the gutters and what sits under the page. */
  contentStyle: StyleProp<ViewStyle>
}

type FoundSongProps = {
  track: Track
  /** The songs found, which a press plays from this one. */
  tracks: readonly Track[]
  index: number
  covers: Covers
  actions: ResultActions
  playingId: number | null
}

/** A song found: a press plays the songs found from it, remembering what was searched for. */
function FoundSong({ track, tracks, index, covers, actions, playingId }: FoundSongProps) {
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

/** The id of the queue's track, so the song playing stands out among those found. */
const usePlayingId = () => useAudioQueue((store) => playingTrackOf(store)?.id ?? null)

type SongsSectionProps = Pick<ResultsProps, 'results' | 'onFilter' | 'covers' | 'actions'> & {
  /** How many of the songs All shows; See all opens the rest. */
  shown: number
}

/** All's songs: the first few found, and See all. */
function SongsSection({ results, onFilter, covers, actions, shown }: SongsSectionProps) {
  const playingId = usePlayingId()
  const { songs } = results
  return (
    <View>
      <SectionHeader onSeeAll={() => onFilter(SEARCH_FILTERS.songs)} title={SEARCH_COPY.songs} />
      {songs.slice(0, shown).map((track, index) => (
        <FoundSong
          actions={actions}
          covers={covers}
          index={index}
          key={track.id}
          playingId={playingId}
          track={track}
          tracks={songs}
        />
      ))}
    </View>
  )
}

/** What a search found, as All shows it on a phone: the top result, then each kind in turn. */
function PhoneAll({ results, query, onFilter, covers, actions, contentStyle }: ResultsProps) {
  const styles = useStyles()
  const { albums, artists, songs } = results
  const top = topResultOf({ query, albums, artists, songs })
  return (
    <ScrollView
      contentContainerStyle={[contentStyle, styles.sections]}
      keyboardShouldPersistTaps="handled"
      style={styles.scroller}
    >
      {top !== null && (
        <TopResultCard actions={actions} covers={covers} result={top} songs={songs} />
      )}
      {albums.length > 0 && (
        <View style={styles.section}>
          <SectionHeader
            onSeeAll={() => onFilter(SEARCH_FILTERS.albums)}
            title={SEARCH_COPY.albums}
          />
          <Shelf albums={albums} coverOf={covers.coverOf} onOpen={actions.openAlbum} />
        </View>
      )}
      {artists.length > 0 && (
        <View style={styles.section}>
          <SectionHeader
            onSeeAll={() => onFilter(SEARCH_FILTERS.artists)}
            title={SEARCH_COPY.artists}
          />
          <ArtistCircles actions={actions} artists={artists} covers={covers} />
        </View>
      )}
      {songs.length > 0 && (
        <SongsSection
          actions={actions}
          covers={covers}
          onFilter={onFilter}
          results={results}
          shown={SONGS_IN_ALL[FORM_FACTORS.phone]}
        />
      )}
    </ScrollView>
  )
}

/** All on a tablet: the songs and albums on the left, the artists on the right. */
function TabletAll({ results, onFilter, covers, actions, contentStyle }: ResultsProps) {
  const styles = useStyles()
  const { albums, artists, songs } = results
  return (
    <ScrollView
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      style={styles.scroller}
    >
      <View style={styles.columns}>
        <View style={styles.main}>
          {songs.length > 0 && (
            <SongsSection
              actions={actions}
              covers={covers}
              onFilter={onFilter}
              results={results}
              shown={SONGS_IN_ALL[FORM_FACTORS.tablet]}
            />
          )}
          {albums.length > 0 && (
            <View style={styles.section}>
              <SectionHeader
                onSeeAll={() => onFilter(SEARCH_FILTERS.albums)}
                title={SEARCH_COPY.albums}
              />
              <TileGrid
                columns={ALBUM_COLUMNS}
                items={albums.slice(0, TABLET_ALBUMS_IN_ALL)}
                keyOf={(album) => album.id}
                renderTile={({ item, width }) => (
                  <AlbumTileOf
                    album={item}
                    coverOf={covers.coverOf}
                    onPress={actions.openAlbum}
                    width={width}
                  />
                )}
              />
            </View>
          )}
        </View>
        <View style={styles.side}>
          {artists.length > 0 && (
            <View>
              <SectionHeader
                onSeeAll={() => onFilter(SEARCH_FILTERS.artists)}
                title={SEARCH_COPY.artists}
              />
              {artists.map((artist) => (
                <ArtistRow
                  albumCount={artist.albumCount}
                  key={artist.id}
                  name={artist.name}
                  onPress={() => actions.openArtist(artist)}
                  picture={covers.artistPhotoOf(artist)}
                  trackCount={artist.trackCount}
                />
              ))}
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  )
}

/** Each form factor's All. */
const ALL_VIEWS = {
  [FORM_FACTORS.phone]: PhoneAll,
  [FORM_FACTORS.tablet]: TabletAll,
} as const satisfies Record<FormFactor, ComponentType<ResultsProps>>

function AllResults(props: ResultsProps) {
  const All = ALL_VIEWS[useFormFactor()]
  return <All {...props} />
}

/** Every song found, a page at a time, the next asked for near the end. */
function SongResults(props: ResultsProps) {
  const { results, covers, actions, contentStyle } = props
  const styles = useStyles()
  const playingId = usePlayingId()
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
      renderItem={({ item }) => (
        <ArtistRow
          albumCount={item.albumCount}
          name={item.name}
          onPress={() => actions.openArtist(item)}
          picture={covers.artistPhotoOf(item)}
          trackCount={item.trackCount}
        />
      )}
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

function Found(props: ResultsProps) {
  const Results = FILTER_VIEWS[props.filter]
  return <Results {...props} />
}

function Searching({ contentStyle }: ResultsProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  return (
    <View style={[contentStyle, styles.searching]}>
      <ActivityIndicator accessibilityLabel={SEARCH_COPY.searching} color={colors.text3} />
    </View>
  )
}

function NoMatches({ query, onClear, contentStyle }: ResultsProps) {
  return (
    <View style={contentStyle}>
      <EmptyState
        action={{
          label: SEARCH_COPY.clearSearch,
          onPress: onClear,
          variant: BUTTON_VARIANTS.secondary,
        }}
        body={SEARCH_COPY.noMatchesHint}
        icon={ICONS.search}
        title={SEARCH_COPY.noMatches(query)}
      />
    </View>
  )
}

function Failed({ results, contentStyle }: ResultsProps) {
  return (
    <View style={contentStyle}>
      <EmptyState
        body={SEARCH_COPY.failedHint(results.failure?.message ?? '')}
        icon={ICONS.alert}
        title={SEARCH_COPY.failed}
      />
    </View>
  )
}

function NoMusic({ contentStyle }: ResultsProps) {
  return (
    <View style={contentStyle}>
      <EmptyState body={SEARCH_COPY.noMusicHint} icon={ICONS.album} title={LIBRARY_COPY.noMusic} />
    </View>
  )
}

const STATE_VIEWS = {
  [RESULT_STATES.noMusic]: NoMusic,
  [RESULT_STATES.failed]: Failed,
  [RESULT_STATES.searching]: Searching,
  [RESULT_STATES.empty]: NoMatches,
  [RESULT_STATES.found]: Found,
} as const satisfies Record<ResultState, ComponentType<ResultsProps>>

/** A search's results, or why there are none, under the field and the chips. */
export function SearchResults(props: ResultsProps) {
  const StateView = STATE_VIEWS[props.results.state]
  return <StateView {...props} />
}
