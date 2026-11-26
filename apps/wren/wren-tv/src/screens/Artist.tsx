import { type AlbumSummary, type ArtistDetails, QUEUE_SOURCE_KINDS, artistNames } from '@raven/core'
import { useServerArtistFavourite } from '@raven/ui/headless'
import { ARTIST_COPY, PLAYER_COPY, artistMetaOf } from '@raven/wren'
import { ScrollView } from 'react-native'

import { AlbumTileOf } from '@/components/AlbumTileOf'
import { useAlbumTracks, useCovers, toastFailure, type WrenSession } from '@raven/wren-native'
import { DetailHead } from '@/screens/detail/DetailHead'
import { DetailRoute } from '@/screens/detail/DetailRoute'
import { DetailSplit } from '@/screens/detail/DetailSplit'
import { TileSection } from '@/screens/library/TileSection'
import { FavouriteButton } from '@/ui/FavouriteButton'
import { SPACE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'

const useStyles = themedStyles(() => ({ albums: { gap: SPACE.s6 } }))

/** An album's year, or nothing for one the server has no year for. */
const yearOf = ({ year }: AlbumSummary): string | null => (year === null ? null : String(year))

type ArtistPageProps = { session: WrenSession; details: ArtistDetails }

function ArtistPage({ session, details }: ArtistPageProps) {
  const styles = useStyles()
  const albumTracks = useAlbumTracks(session)
  const { coverOf, artistPhotoOf } = useCovers(session)
  const { artist, albums, appearsOn, isFavourite } = details
  const favourite = useServerArtistFavourite({ api: session.api, artistId: artist.id })
  // The artist's songs are their albums' tracks, read only once something plays them.
  const tracksOf = () => albumTracks(albums.map(({ id }) => id))
  const meta = artistMetaOf({ artist })
  const follow = () => favourite.attempt({ variables: !isFavourite, onRefused: toastFailure })
  return (
    <DetailSplit
      head={
        <DetailHead
          actions={
            <FavouriteButton isOn={isFavourite} label={PLAYER_COPY.follow} onToggle={follow} />
          }
          cover={artistPhotoOf(artist)}
          isRound
          menu={{ canAddToPlaylist: false, line: meta, places: {} }}
          meta={meta}
          session={session}
          source={{ kind: QUEUE_SOURCE_KINDS.artist, id: artist.id }}
          title={artist.name}
          tracksOf={tracksOf}
        />
      }
      list={
        <ScrollView contentContainerStyle={styles.albums}>
          <TileSection
            items={albums}
            keyOf={(album) => album.id}
            renderTile={(album) => (
              <AlbumTileOf album={album} coverOf={coverOf} line={yearOf(album)} />
            )}
            title={ARTIST_COPY.albums}
          />
          <TileSection
            items={appearsOn}
            keyOf={(album) => album.id}
            renderTile={(album) => (
              <AlbumTileOf album={album} coverOf={coverOf} line={artistNames(album)} />
            )}
            title={ARTIST_COPY.appearsOn}
          />
        </ScrollView>
      }
    />
  )
}

/**
 * `/artist/[id]`: the artist's photo or initial, their name and counts, Play, Shuffle, Follow and
 * More, then their albums and the albums of others they appear on.
 */
export function Artist() {
  return (
    <DetailRoute Page={ArtistPage} copy={ARTIST_COPY} queryOf={(queries) => queries.artistQuery} />
  )
}
