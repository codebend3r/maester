import { useAudioQueue } from '@raven/ui/headless'
import { LIBRARY_PAGE_COPY, favouritesOf } from '@raven/wren'
import { FlatList, View } from 'react-native'

import { PlayButtons } from '@/components/PlayButtons'
import { SongTrackRow } from '@/components/SongTrackRow'
import { LIST_SHAPES } from '@/components/ListSkeleton'
import { useCovers } from '@/music/useCovers'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { ListNotice } from '@/screens/library/ListNotice'
import {
  useFavouriteAlbums,
  useFavouriteArtists,
  useFavouriteTracks,
} from '@/screens/library/listings'
import { usePageInsets } from '@/shell/useShell'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SIZE, SPACE } from '@/theme/wrenTokens'
import { AlbumTileOf } from '@/ui/AlbumTile'
import { ArtistCard } from '@/ui/ArtistCard'
import { SectionHeader } from '@/ui/SectionHeader'
import { TileGrid } from '@/ui/TileGrid'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  header: { gap: SPACE.s4, paddingBottom: SPACE.s1 },
  section: { gap: SPACE.s3 },
  actions: { flexDirection: 'row', gap: SPACE.s3 },
}))

/**
 * Favourites: the artists, the albums and the songs marked a favourite, each under its own
 * heading, the artists as cards, the albums as tiles and the songs as rows with Play and Shuffle.
 * A heading shows only while its list has something; the page says so once all are empty.
 */
export function FavouritesCollection({ session, onBack }: CollectionPageProps) {
  const styles = useStyles()
  const insets = usePageInsets()
  const { artists, listing: artistListing } = useFavouriteArtists(session)
  const { albums, listing: albumListing } = useFavouriteAlbums(session)
  const { tracks, listing: trackListing } = useFavouriteTracks(session)
  const { artistPhotoOf, coverOf, trackCoverOf } = useCovers(session)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const { listing, isEmpty, countLine } = favouritesOf({
    artists: { count: artists.length, listing: artistListing },
    albums: { count: albums.length, listing: albumListing },
    tracks: { count: tracks.length, listing: trackListing },
  })
  return (
    <FlatList
      ListEmptyComponent={
        <>
          {isEmpty && (
            <ListNotice
              empty={LIBRARY_PAGE_COPY.noFavourites}
              listing={listing}
              shape={LIST_SHAPES.rows}
            />
          )}
        </>
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <CollectionHeader
            count={countLine}
            onBack={onBack}
            title={LIBRARY_PAGE_COPY.favourites}
          />
          {artists.length > 0 && (
            <View style={styles.section}>
              <SectionHeader title={LIBRARY_PAGE_COPY.artists} />
              <TileGrid
                items={artists}
                keyOf={(artist) => artist.id}
                renderTile={({ item, width }) => (
                  <ArtistCard artist={item} photoOf={artistPhotoOf} width={width} />
                )}
                tile={SIZE.artistCard}
              />
            </View>
          )}
          {albums.length > 0 && (
            <View style={styles.section}>
              <SectionHeader title={LIBRARY_PAGE_COPY.albums} />
              <TileGrid
                items={albums}
                keyOf={(album) => album.id}
                renderTile={({ item, width }) => (
                  <AlbumTileOf album={item} coverOf={coverOf} width={width} />
                )}
              />
            </View>
          )}
          {tracks.length > 0 && (
            <View style={styles.section}>
              <SectionHeader title={LIBRARY_PAGE_COPY.songs} />
              <View style={styles.actions}>
                <PlayButtons
                  onPlay={() => playTracks({ tracks })}
                  onShuffle={() => playTracks({ tracks, isShuffled: true })}
                />
              </View>
            </View>
          )}
        </View>
      }
      contentContainerStyle={insets}
      data={tracks}
      keyExtractor={(track) => String(track.id)}
      renderItem={({ item, index }) => (
        <SongTrackRow
          cover={trackCoverOf(item)}
          onPress={() => playTracks({ tracks, startAt: index })}
          track={item}
        />
      )}
      style={styles.ground}
    />
  )
}
