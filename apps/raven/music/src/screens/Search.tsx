import { type AlbumSummary, type Artist, MUSIC_SORTS, type Track, plural } from '@raven/core'
import { playingTrackOf, useAudioQueue, useSearch } from '@raven/ui/headless'
import { useInfiniteQuery, useQueries } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { FlatList, SectionList, StyleSheet, Text, TextInput, View } from 'react-native'

import { useTileWidth } from '@/components/AlbumGrid'
import { AlbumTile } from '@/components/AlbumTile'
import { ListRow } from '@/components/ListRow'
import { Notice } from '@/components/Notice'
import { SongRow } from '@/components/SongList'
import { PageTitle, pageStyles, usePageTop } from '@/components/TabPage'
import { byName, byTitle, mergedOf } from '@/music/merged'
import { useMusicLibraries } from '@/music/musicLibraries'
import { type CoverOf, useCovers } from '@/music/useCovers'
import { WREN_PAGES, pageHref } from '@/routes'
import { PALETTE, SIZES } from '@/theme/wrenTheme'
import { type WrenSession, useWren } from '@/useWren'

const COPY = {
  title: 'Search',
  label: 'Search your music',
  hint: 'Find albums, artists and songs in every music library.',
  searching: 'Searching',
  nothing: (query: string) => `Nothing in your music matches "${query}".`,
  albums: 'Albums',
  artists: 'Artists',
  songs: 'Songs',
} as const

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

function ResultRow({ result, songs, playingId, coverOf }: ResultRowProps) {
  const router = useRouter()
  const { tileWidth } = useTileWidth()
  switch (result.kind) {
    case RESULT_KINDS.albums:
      return (
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
    case RESULT_KINDS.artist:
      return (
        <ListRow
          line={plural({ n: result.artist.albumCount, one: 'album', many: 'albums' })}
          onPress={() => router.push(pageHref({ page: WREN_PAGES.artist, id: result.artist.id }))}
          title={result.artist.name}
        />
      )
    case RESULT_KINDS.song:
      return (
        <SongRow
          index={result.index}
          isPlaying={result.track.id === playingId}
          track={result.track}
          tracks={songs}
        />
      )
    default: {
      const unknown: never = result
      return unknown
    }
  }
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
        title: COPY.albums,
        data:
          albums.length === 0
            ? []
            : [{ kind: RESULT_KINDS.albums, key: RESULT_KINDS.albums, albums }],
      },
      {
        key: RESULT_KINDS.artist,
        title: COPY.artists,
        data: artists.map((artist) => ({
          kind: RESULT_KINDS.artist,
          key: String(artist.id),
          artist,
        })),
      },
      {
        key: RESULT_KINDS.song,
        title: COPY.songs,
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
  const top = usePageTop()
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
  const albums = mergedOf({ listings: albumListings })
  const artists = mergedOf({ listings: artistListings })
  const tracks = isAsked ? (songs.data?.pages.flatMap((page) => page.tracks) ?? []) : []
  const sections = isAsked
    ? sectionsOf({
        albums: music.libraries.length > 1 ? byTitle(albums.entries) : albums.entries,
        artists: music.libraries.length > 1 ? byName(artists.entries) : artists.entries,
        songs: tracks,
      })
    : []
  const notice = ((): string | null => {
    if (!isAsked) return COPY.hint
    const failure = music.failure ?? albums.failure ?? artists.failure ?? songs.error
    if (failure !== null) return failure.message
    if (sections.length > 0) return null
    const isRead = music.isRead && albums.isRead && artists.isRead && songs.isSuccess
    return isRead ? COPY.nothing(query) : COPY.searching
  })()
  const onEnd = () => {
    if (!songs.hasNextPage || songs.isFetchingNextPage) return
    // A page that fails keeps its error on the query, which the page says.
    songs.fetchNextPage().catch(() => undefined)
  }
  return (
    <SectionList
      ListHeaderComponent={
        <View style={styles.header}>
          <PageTitle title={COPY.title} />
          <TextInput
            accessibilityLabel={COPY.label}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            onChangeText={search.setText}
            onSubmitEditing={search.searchNow}
            placeholder={COPY.label}
            placeholderTextColor={PALETTE.muted}
            returnKeyType="search"
            style={styles.input}
            value={search.text}
          />
          {notice !== null && <Notice text={notice} />}
        </View>
      }
      contentContainerStyle={[pageStyles.content, { paddingTop: top }]}
      keyExtractor={(result) => result.key}
      keyboardShouldPersistTaps="handled"
      onEndReached={onEnd}
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
  header: { gap: SIZES.space3 },
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
