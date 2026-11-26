import { LIBRARY_PAGE_COPY, favouritesOf } from '@raven/wren'
import { View } from 'react-native'

import { ListNotice } from '@/components/ListNotice'
import { usePageStyles } from '@/ui/pageStyles'
import { themedStyles } from '@/theme/wrenTheme'
import {
  useCovers,
  useFavouriteAlbums,
  useFavouriteArtists,
  useFavouriteTracks,
} from '@raven/wren-native'
import { AlbumTileOf } from '@/components/AlbumTileOf'
import { ArtistTileOf } from '@/components/ArtistTileOf'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { PlayButtons } from '@/components/PlayButtons'
import { TileSection } from '@/screens/library/TileSection'
import { TracksPage } from '@/screens/library/TracksPage'
import { SIZE, SPACE } from '@/theme/tvTokens'
import { SectionHeader } from '@/ui/Headers'

const useStyles = themedStyles(() => ({ actions: { flexDirection: 'row', gap: SPACE.s3 } }))

/**
 * Favourites: the artists, the albums and the songs marked a favourite, each under its own
 * heading, the artists and albums as tiles and the songs as rows with Play and Shuffle. A heading
 * shows only while its list has something; the page says so once all are empty.
 */
export function FavouritesCollection({ session }: CollectionPageProps) {
  const styles = useStyles()
  const page = usePageStyles()
  const { artists, listing: artistListing } = useFavouriteArtists(session)
  const { albums, listing: albumListing } = useFavouriteAlbums(session)
  const { tracks, listing: trackListing } = useFavouriteTracks(session)
  const { artistPhotoOf, coverOf } = useCovers(session)
  const { listing, isEmpty, countLine } = favouritesOf({
    artists: { count: artists.length, listing: artistListing },
    albums: { count: albums.length, listing: albumListing },
    tracks: { count: tracks.length, listing: trackListing },
  })
  return (
    <TracksPage
      // The page's notice stands in the header, since the songs may be none while the rest show.
      empty={null}
      header={
        <View style={page.section}>
          <CollectionHeader count={countLine} title={LIBRARY_PAGE_COPY.favourites} />
          {isEmpty && <ListNotice empty={LIBRARY_PAGE_COPY.noFavourites} listing={listing} />}
          <TileSection
            items={artists}
            keyOf={(artist) => artist.id}
            renderTile={(artist) => (
              <ArtistTileOf artist={artist} photoOf={artistPhotoOf} width={SIZE.artistPhoto} />
            )}
            title={LIBRARY_PAGE_COPY.artists}
          />
          <TileSection
            items={albums}
            keyOf={(album) => album.id}
            renderTile={(album) => (
              <AlbumTileOf album={album} coverOf={coverOf} width={SIZE.tile} />
            )}
            title={LIBRARY_PAGE_COPY.albums}
          />
          {tracks.length > 0 && (
            <View style={page.section}>
              <SectionHeader title={LIBRARY_PAGE_COPY.songs} />
              <View style={styles.actions}>
                <PlayButtons tracksOf={async () => tracks} />
              </View>
            </View>
          )}
        </View>
      }
      listing={listing}
      session={session}
      tracks={tracks}
    />
  )
}
