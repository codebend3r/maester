import { LIBRARY_PAGE_COPY, favouritesOf } from '@raven/wren'
import { AlbumGrid } from '@/components/AlbumGrid/AlbumGrid'
import { ArtistGrid } from '@/components/ArtistGrid/ArtistGrid'
import { ListNotice } from '@/components/ListNotice/ListNotice'
import { LIST_SHAPES } from '@/components/ListSkeleton/ListSkeleton'
import { Section } from '@/components/Section/Section'
import { useFavouriteAlbums, useFavouriteArtists, useFavouriteTracks } from '@/music/listings'
import { CollectionHeader } from '@/screens/Collection/CollectionHeader'
import { TrackActions, TrackList } from '@/screens/Collection/TrackList'
import { Page } from '@/shell/Page/Page'
import styles from '@/screens/Collection/FavouritesCollection.module.scss'

/**
 * Favourites: the artists, the albums and the songs marked a favourite, each under its own
 * heading, the artists as cards, the albums as tiles and the songs as rows with Play and Shuffle.
 * A heading shows only while its list has something; the page says so once all are empty.
 */
export function FavouritesCollection() {
  const { artists, listing: artistListing } = useFavouriteArtists()
  const { albums, listing: albumListing } = useFavouriteAlbums()
  const { tracks, listing: trackListing } = useFavouriteTracks()
  const { listing, isEmpty, countLine } = favouritesOf({
    artists: { count: artists.length, listing: artistListing },
    albums: { count: albums.length, listing: albumListing },
    tracks: { count: tracks.length, listing: trackListing },
  })
  return (
    <Page className={styles.page}>
      <CollectionHeader count={countLine} title={LIBRARY_PAGE_COPY.favourites} />
      {isEmpty && (
        <ListNotice
          empty={LIBRARY_PAGE_COPY.noFavourites}
          listing={listing}
          shape={LIST_SHAPES.rows}
        />
      )}
      {artists.length > 0 && (
        <Section title={LIBRARY_PAGE_COPY.artists}>
          <ArtistGrid artists={artists} />
        </Section>
      )}
      {albums.length > 0 && (
        <Section title={LIBRARY_PAGE_COPY.albums}>
          <AlbumGrid albums={albums} />
        </Section>
      )}
      {tracks.length > 0 && (
        <Section title={LIBRARY_PAGE_COPY.songs}>
          <TrackActions tracks={tracks} />
          <TrackList tracks={tracks} />
        </Section>
      )}
    </Page>
  )
}
