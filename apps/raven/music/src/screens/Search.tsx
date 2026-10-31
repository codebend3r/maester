import { type AlbumSummary, type Artist, MUSIC_SORTS, type Track, plural } from '@raven/core'
import { playingTrackOf, useAudioQueue, useSearch } from '@raven/ui/headless'
import { useInfiniteQuery, useQueries } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import type { ComponentType } from 'react'
import { FlatList, SectionList, StyleSheet, Text, TextInput, View } from 'react-native'

import { useTileWidth } from '@/components/AlbumGrid'
import { AlbumTile } from '@/components/AlbumTile'
import { ListRow } from '@/components/ListRow'
import { Notice } from '@/components/Notice'
import { SongRow } from '@/components/SongList'
import { PageTitle, pageStyles, useListContent } from '@/components/TabPage'
import { byName, byTitle, mergedOf } from '@/music/merged'
import { LIBRARY_COPY, useMusicLibraries } from '@/music/musicLibraries'
import { nextPageOf } from '@/music/nextPage'
import { type CoverOf, useCovers } from '@/music/useCovers'
import { COUNT_COPY, SEARCH_COPY } from '@/screens/copy'
import { WREN_PAGES, pageHref } from '@/routes'
import { PALETTE, SIZES } from '@/theme/wrenTheme'
import { type WrenSession, useWren } from '@/useWren'

/** What a row of the results is: the run of albums, an artist, or a song. */
const RESULT_KINDS = { albums: 'albums', artist: 'artist', song: 'song' } as const

type Result =
  | { kind: typeof RESULT_KINDS.albums; key: string; albums: readonly AlbumSummary[] }
  | { kind: typeof RESULT_KINDS.artist; key: string; artist: Artist }
  | { kind: typeof RESULT_KINDS.song; key: string; track: Track; index: number }

type ResultSection = { key: string; title: string; data: Result[] }

type ResultRowProps = {
  result: Result
  songs: readonly Track[]
  playingId: number | null
  coverOf: CoverOf
}

type AlbumsResultProps = ResultRowProps

/** The run of albums that match, in a row that scrolls sideways. */
function AlbumsResult({ result, coverOf }: AlbumsResultProps) {
  const { tileWidth } = useTileWidth()
  return (
    result.kind === RESULT_KINDS.albums && (
      <FlatList
        contentContainerStyle={styles.albums}
        data={result.albums}
        horizontal
        keyExtractor={(album) => String(album.id)}
        renderItem={({ item }) => (
          <AlbumTile
            album={item}
            cover={coverOf({ albumId: item.id, coverVersion: item.coverVersion })}
            width={tileWidth}
          />
        )}
        showsHorizontalScrollIndicator={false}
      />
    )
  )
}

type ArtistResultProps = ResultRowProps

/** An artist that matches, a press opening their page. */
function ArtistResult({ result }: ArtistResultProps) {
  const router = useRouter()
  return (
    result.kind === RESULT_KINDS.artist && (
      <ListRow
        line={plural({ n: result.artist.albumCount, ...COUNT_COPY.albums })}
        onPress={() => router.push(pageHref({ page: WREN_PAGES.artist, id: result.artist.id }))}
        title={result.artist.name}
      />
    )
  )
}

type SongResultProps = ResultRowProps

/** A song that matches, a press playing the songs found from it. */
function SongResult({ result, songs, playingId }: SongResultProps) {
  return (
    result.kind === RESULT_KINDS.song && (
      <SongRow
        index={result.index}
        isPlaying={result.track.id === playingId}
        track={result.track}
        tracks={songs}
      />
    )
  )
}

/** How each kind of result is drawn. */
const RESULT_ROWS = {
  [RESULT_KINDS.albums]: AlbumsResult,
  [RESULT_KINDS.artist]: ArtistResult,
  [RESULT_KINDS.song]: SongResult,
} as const satisfies Record<Result['kind'], ComponentType<ResultRowProps>>

function ResultRow(props: ResultRowProps) {
  const Row = RESULT_ROWS[props.result.kind]
  return <Row {...props} />
}

type SectionsOfProps = {
  albums: readonly AlbumSummary[]
  artists: readonly Artist[]
  songs: readonly Track[]
}

/** The results as the list's sections, in that order, each left out when it holds nothing. */
const sectionsOf = ({ albums, artists, songs }: SectionsOfProps): ResultSection[] =>
  (
    [
      {
        key: RESULT_KINDS.albums,
        title: SEARCH_COPY.albums,
        data:
          albums.length === 0
            ? []
            : [{ kind: RESULT_KINDS.albums, key: RESULT_KINDS.albums, albums }],
      },
      {
        key: RESULT_KINDS.artist,
        title: SEARCH_COPY.artists,
        data: artists.map((artist) => ({
          kind: RESULT_KINDS.artist,
          key: String(artist.id),
          artist,
        })),
      },
      {
        key: RESULT_KINDS.song,
        title: SEARCH_COPY.songs,
        data: songs.map((track, index) => ({
          kind: RESULT_KINDS.song,
          key: `${track.id}:${index}`,
          track,
          index,
        })),
      },
    ] satisfies ResultSection[]
  ).filter(({ data }) => data.length > 0)

type ServerSearchProps = { session: WrenSession }

function ServerSearch({ session }: ServerSearchProps) {
  const listContent = useListContent()
  const search = useSearch()
  const { query } = search
  const isAsked = query !== ''
  const coverOf = useCovers(session)
  const playingId = useAudioQueue((store) => playingTrackOf(store)?.id ?? null)
  const music = useMusicLibraries(session)
  const albumListings = useQueries({
    queries: music.libraries.map((library) => ({
      ...session.queries.albumsQuery({
        libraryId: library.id,
        search: query,
        sort: MUSIC_SORTS.title,
      }),
      enabled: isAsked,
    })),
  })
  const artistListings = useQueries({
    queries: music.libraries.map((library) => ({
      ...session.queries.artistsQuery({ libraryId: library.id, search: query }),
      enabled: isAsked,
    })),
  })
  // A blank search names no library, so it asks for no songs.
  const songs = useInfiniteQuery(
    session.queries.songsQuery({
      libraryIds: isAsked ? music.libraries.map(({ id }) => id) : [],
      search: query,
      sort: MUSIC_SORTS.title,
    }),
  )
  const albums = mergedOf({ music, listings: albumListings, order: byTitle })
  const artists = mergedOf({ music, listings: artistListings, order: byName })
  const tracks = isAsked ? (songs.data?.pages.flatMap((page) => page.tracks) ?? []) : []
  const sections = isAsked
    ? sectionsOf({
        albums: albums.entries,
        artists: artists.entries,
        songs: tracks,
      })
    : []
  const notice = ((): string | null => {
    if (albums.hasNoMusic) return LIBRARY_COPY.noMusic
    // Before a search only the libraries' own failure counts: a blank one's listings ask nothing.
    if (!isAsked) return music.failure?.message ?? SEARCH_COPY.hint
    const failure = albums.failure ?? artists.failure ?? songs.error
    if (failure !== null) return failure.message
    if (sections.length > 0) return null
    const isRead = albums.isRead && artists.isRead && songs.isSuccess
    return isRead ? SEARCH_COPY.nothing(query) : SEARCH_COPY.searching
  })()
  return (
    <SectionList
      ListHeaderComponent={
        <View style={pageStyles.header}>
          <PageTitle title={SEARCH_COPY.title} />
          <TextInput
            accessibilityLabel={SEARCH_COPY.label}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            onChangeText={search.setText}
            onSubmitEditing={search.searchNow}
            placeholder={SEARCH_COPY.label}
            placeholderTextColor={PALETTE.muted}
            returnKeyType="search"
            style={styles.input}
            value={search.text}
          />
          {notice !== null && <Notice text={notice} />}
        </View>
      }
      contentContainerStyle={listContent}
      keyExtractor={(result) => result.key}
      keyboardShouldPersistTaps="handled"
      onEndReached={nextPageOf(songs)}
      renderItem={({ item }) => (
        <ResultRow coverOf={coverOf} playingId={playingId} result={item} songs={tracks} />
      )}
      renderSectionHeader={({ section }) => (
        <Text accessibilityRole="header" style={styles.heading}>
          {section.title}
        </Text>
      )}
      sections={sections}
      stickySectionHeadersEnabled={false}
      style={pageStyles.ground}
    />
  )
}

/** Albums, artists and songs in every music library, asked for once typing pauses. */
export function Search() {
  const session = useWren()
  return session !== null && <ServerSearch session={session} />
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: PALETTE.raised,
    borderColor: PALETTE.line,
    borderRadius: SIZES.radius,
    borderWidth: 1,
    color: PALETTE.text,
    fontSize: SIZES.text,
    minHeight: SIZES.fieldHeight,
    paddingHorizontal: SIZES.space2,
  },
  heading: {
    backgroundColor: PALETTE.ground,
    color: PALETTE.text,
    fontSize: SIZES.textLg,
    fontWeight: 'bold',
    paddingTop: SIZES.space2,
  },
  albums: { gap: SIZES.space3 },
})
