import { type ArtistDetails, routeIdOf } from '@raven/core'
import { useServerArtistFavourite } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

import { AlbumGrid } from '@/components/AlbumGrid'
import { FavouriteToggle } from '@/components/Controls'
import { DetailPage, DetailRoute } from '@/components/DetailPage'
import { Notice } from '@/components/Notice'
import { artistFactsOf } from '@/music/artistFacts'
import { useCovers } from '@/music/useCovers'
import { ARTIST_COPY } from '@/screens/copy'
import { WREN_ROUTE_PARAMS } from '@/routes'
import { PALETTE, SIZES } from '@/theme/wrenTheme'
import { type WrenSession, useWren } from '@/useWren'

type ArtistPageProps = { session: WrenSession; details: ArtistDetails }

function ArtistPage({ session, details }: ArtistPageProps) {
  const coverOf = useCovers(session)
  const { artist, albums, appearsOn, isFavourite } = details
  const favourite = useServerArtistFavourite({ api: session.api, artistId: artist.id })
  return (
    <DetailPage>
      <View style={styles.head}>
        <View style={styles.name}>
          <Text accessibilityRole="header" style={styles.title}>
            {artist.name}
          </Text>
          <Text style={styles.facts}>{artistFactsOf({ artist })}</Text>
        </View>
        <FavouriteToggle isOn={isFavourite} onToggle={() => favourite.mutate(!isFavourite)} />
      </View>
      {favourite.failure !== null && <Notice text={favourite.failure.message} />}
      {albums.length > 0 && (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>
            {ARTIST_COPY.albums}
          </Text>
          <AlbumGrid albums={albums} coverOf={coverOf} />
        </View>
      )}
      {appearsOn.length > 0 && (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>
            {ARTIST_COPY.appearsOn}
          </Text>
          <AlbumGrid albums={appearsOn} coverOf={coverOf} />
        </View>
      )}
    </DetailPage>
  )
}

type ServerArtistProps = { session: WrenSession; id: number | null }

function ServerArtist({ session, id }: ServerArtistProps) {
  const artist = useQuery(session.queries.artistQuery(id))
  return (
    <DetailRoute copy={ARTIST_COPY} id={id} query={artist}>
      {(details) => <ArtistPage details={details} session={session} />}
    </DetailRoute>
  )
}

/** `/artist/[id]`: an artist's albums, the albums of others they appear on, and Favourite. */
export function Artist() {
  const session = useWren()
  const params = useLocalSearchParams()
  const id = routeIdOf(params[WREN_ROUTE_PARAMS.id])
  return session !== null && <ServerArtist id={id} session={session} />
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', flexDirection: 'row', gap: SIZES.space2 },
  name: { flex: 1, gap: SIZES.space1 },
  title: { color: PALETTE.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  facts: { color: PALETTE.muted, fontSize: SIZES.textSm },
  section: { gap: SIZES.space2 },
  heading: { color: PALETTE.text, fontSize: SIZES.textLg, fontWeight: 'bold' },
})
