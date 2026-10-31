import { type AlbumDetails, QUEUE_SOURCE_KINDS, routeIdOf } from '@raven/core'
import {
  type AlbumTrack,
  albumDiscsOf,
  albumFactsOf,
  playingTrackOf,
  useAudioQueue,
  useServerAlbumFavourite,
} from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, SectionList, StyleSheet, Text, View, useWindowDimensions } from 'react-native'

import { AlbumArt } from '@/components/AlbumTile'
import { FavouriteToggle, PlayButtons } from '@/components/Controls'
import { BackButton, DetailRoute } from '@/components/DetailPage'
import { Notice } from '@/components/Notice'
import { pageStyles, useListContent } from '@/components/TabPage'
import { TrackRow } from '@/components/TrackRow'
import { useCovers } from '@/music/useCovers'
import { ALBUM_COPY } from '@/screens/copy'
import { WREN_PAGES, WREN_ROUTE_PARAMS, pageHref } from '@/routes'
import { OPACITIES, PALETTE, SIZES } from '@/theme/wrenTheme'
import { type WrenSession, useWren } from '@/useWren'

type AlbumPageProps = { session: WrenSession; details: AlbumDetails }

type RenderRowProps = { item: AlbumTrack }

function AlbumPage({ session, details }: AlbumPageProps) {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const content = useListContent()
  const coverOf = useCovers(session)
  const playingId = useAudioQueue((store) => playingTrackOf(store)?.id ?? null)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const { album, tracks, discCount, isFavourite } = details
  const favourite = useServerAlbumFavourite({ api: session.api, albumId: album.id })
  const source = { kind: QUEUE_SOURCE_KINDS.album, id: album.id } as const
  const coverSize = Math.min(width - 2 * SIZES.space4, SIZES.measure / 2)
  const discs = albumDiscsOf({ tracks, discCount }).map((disc) => ({ ...disc, data: disc.tracks }))
  const renderRow = ({ item }: RenderRowProps) => {
    const track = tracks[item.index]
    return (
      track !== undefined && (
        <TrackRow
          isPlaying={item.id === playingId}
          label={item.label}
          lead={item.number}
          length={item.length}
          line={null}
          onPress={() => playTracks({ tracks, startAt: item.index, source })}
          track={track}
        />
      )
    )
  }
  return (
    <SectionList
      ListHeaderComponent={
        <View style={pageStyles.header}>
          <BackButton />
          <View style={styles.head}>
            <AlbumArt
              cover={coverOf({ albumId: album.id, coverVersion: album.coverVersion })}
              size={coverSize}
            />
            <Text accessibilityRole="header" style={styles.title}>
              {album.title}
            </Text>
            <View style={styles.artists}>
              {album.artists.map((artist) => (
                <Pressable
                  accessibilityLabel={ALBUM_COPY.openArtist(artist.name)}
                  accessibilityRole="link"
                  key={artist.id}
                  onPress={() => router.push(pageHref({ page: WREN_PAGES.artist, id: artist.id }))}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Text style={styles.artist}>{artist.name}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.facts}>{albumFactsOf({ album })}</Text>
          </View>
          <View style={styles.actions}>
            <PlayButtons
              onPlay={() => playTracks({ tracks, source })}
              onShuffle={() => playTracks({ tracks, source, isShuffled: true })}
            />
            <FavouriteToggle isOn={isFavourite} onToggle={() => favourite.mutate(!isFavourite)} />
          </View>
          {favourite.failure !== null && <Notice text={favourite.failure.message} />}
        </View>
      }
      contentContainerStyle={content}
      keyExtractor={(row) => row.key}
      renderItem={renderRow}
      renderSectionHeader={({ section }) =>
        section.title !== null && (
          <Text accessibilityRole="header" style={styles.disc}>
            {section.title}
          </Text>
        )
      }
      sections={discs}
      stickySectionHeadersEnabled={false}
      style={pageStyles.ground}
    />
  )
}

type ServerAlbumProps = { session: WrenSession; id: number | null }

function ServerAlbum({ session, id }: ServerAlbumProps) {
  const album = useQuery(session.queries.albumQuery(id))
  return (
    <DetailRoute copy={ALBUM_COPY} id={id} query={album}>
      {(details) => <AlbumPage details={details} session={session} />}
    </DetailRoute>
  )
}

/** `/album/[id]`: the cover, the artists and the facts, Play and Shuffle, and the tracks by disc. */
export function Album() {
  const session = useWren()
  const params = useLocalSearchParams()
  const id = routeIdOf(params[WREN_ROUTE_PARAMS.id])
  return session !== null && <ServerAlbum id={id} session={session} />
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: SIZES.space2 },
  title: { color: PALETTE.text, fontSize: SIZES.textXl, fontWeight: 'bold', textAlign: 'center' },
  artists: { flexDirection: 'row', flexWrap: 'wrap', gap: SIZES.space2, justifyContent: 'center' },
  artist: { color: PALETTE.accent, fontSize: SIZES.text, fontWeight: 'bold' },
  facts: { color: PALETTE.muted, fontSize: SIZES.textSm },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SIZES.space2,
    justifyContent: 'center',
  },
  disc: {
    color: PALETTE.text,
    fontSize: SIZES.textLg,
    fontWeight: 'bold',
    paddingVertical: SIZES.space2,
  },
  pressed: { opacity: OPACITIES.pressed },
})
