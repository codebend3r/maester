import { type AlbumSummary, type ArtistDetails, QUEUE_SOURCE_KINDS, artistNames } from '@raven/core'
import { useServerArtistFavourite } from '@raven/ui/headless'
import { ARTIST_COPY, PLAYER_COPY, artistMetaOf } from '@raven/wren'
import { ScrollView, View } from 'react-native'

import { AlbumTileOf } from '@/components/AlbumTileOf'
import { TracksMenu } from '@/components/TracksMenu'
import {
  useAlbumTracks,
  type CoverOf,
  useCovers,
  toastFailure,
  type WrenSession,
} from '@raven/wren-native'
import { DetailHead } from '@/screens/detail/DetailHead'
import { DetailRoute } from '@/screens/detail/DetailRoute'
import { DetailSplit } from '@/screens/detail/DetailSplit'
import { useTracklist } from '@/screens/detail/useTracklist'
import { FavouriteButton } from '@/ui/FavouriteButton'
import { SPACE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { SectionHeader } from '@/ui/Headers'
import { TileGrid } from '@/ui/TileGrid'
import { usePageStyles } from '@/ui/pageStyles'

const useStyles = themedStyles(() => ({ albums: { gap: SPACE.s6 } }))

type AlbumsSectionProps = {
  title: string
  albums: readonly AlbumSummary[]
  coverOf: CoverOf
  /** The line under each album's title: its year on the artist's own, else its artists. */
  lineOf: (album: AlbumSummary) => string | null
}

/** A section of the artist's albums, each a tile that opens its page; none when it holds none. */
function AlbumsSection({ title, albums, coverOf, lineOf }: AlbumsSectionProps) {
  const styles = usePageStyles()
  return (
    albums.length > 0 && (
      <View style={styles.section}>
        <SectionHeader title={title} />
        <TileGrid
          items={albums}
          keyOf={(album) => album.id}
          renderTile={(album) => (
            <AlbumTileOf album={album} coverOf={coverOf} line={lineOf(album)} />
          )}
        />
      </View>
    )
  )
}

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
  const { tracksOf, isMenuOpen, openMenu, closeMenu } = useTracklist({
    tracksOf: () => albumTracks(albums.map(({ id }) => id)),
  })
  const follow = () => favourite.attempt({ variables: !isFavourite, onRefused: toastFailure })
  return (
    <>
      <DetailSplit
        head={
          <DetailHead
            actions={
              <FavouriteButton isOn={isFavourite} label={PLAYER_COPY.follow} onToggle={follow} />
            }
            cover={artistPhotoOf(artist)}
            isRound
            meta={artistMetaOf({ artist })}
            onMore={openMenu}
            source={{ kind: QUEUE_SOURCE_KINDS.artist, id: artist.id }}
            title={artist.name}
            tracksOf={tracksOf}
          />
        }
        list={
          <ScrollView contentContainerStyle={styles.albums}>
            <AlbumsSection
              albums={albums}
              coverOf={coverOf}
              lineOf={yearOf}
              title={ARTIST_COPY.albums}
            />
            <AlbumsSection
              albums={appearsOn}
              coverOf={coverOf}
              lineOf={artistNames}
              title={ARTIST_COPY.appearsOn}
            />
          </ScrollView>
        }
      />
      {isMenuOpen && (
        <TracksMenu
          canAddToPlaylist={false}
          head={{ title: artist.name, line: artistMetaOf({ artist }) }}
          onClose={closeMenu}
          places={{}}
          session={session}
          tracksOf={tracksOf}
        />
      )}
    </>
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
