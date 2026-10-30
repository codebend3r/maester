import {
  type AlbumDetails,
  QUEUE_SOURCE_KINDS,
  ROUTE_STATES,
  routeIdOf,
  routeState,
} from '@raven/core'
import {
  albumDiscsOf,
  albumFactsOf,
  playingTrackOf,
  useAudioQueue,
  useServerAlbumFavourite,
} from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'

import { AlbumArt } from '@/components/AlbumTile'
import { ActionButton, FavouriteToggle } from '@/components/Controls'
import { DetailNotice, DetailPage } from '@/components/DetailPage'
import { Notice } from '@/components/Notice'
import { TrackRow } from '@/components/TrackRow'
import { useCovers } from '@/music/useCovers'
import { WREN_PAGES, WREN_ROUTE_PARAMS, pageHref } from '@/routes'
import { WREN_ICONS } from '@/theme/icons'
import { OPACITIES, PALETTE, SIZES } from '@/theme/wrenTheme'
import { type WrenSession, useWren } from '@/useWren'

const COPY = {
  opening: 'Opening the album',
  missing: 'This album is not on the server.',
  play: 'Play',
  shuffle: 'Shuffle',
  openArtist: (name: string) => `Go to ${name}`,
} as const

type AlbumPageProps = { session: WrenSession; details: AlbumDetails }

function AlbumPage({ session, details }: AlbumPageProps) {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const coverOf = useCovers(session)
  const playingId = useAudioQueue((store) => playingTrackOf(store)?.id ?? null)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const { album, tracks, discCount, isFavourite } = details
  const favourite = useServerAlbumFavourite({ api: session.api, albumId: album.id })
  const source = { kind: QUEUE_SOURCE_KINDS.album, id: album.id } as const
  const coverSize = Math.min(width - 2 * SIZES.space4, SIZES.measure / 2)
  return (
    <DetailPage>
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
              accessibilityLabel={COPY.openArtist(artist.name)}
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
        <ActionButton
          icon={WREN_ICONS.play}
          isPrimary
          label={COPY.play}
          onPress={() => playTracks({ tracks, source })}
        />
        <ActionButton
          icon={WREN_ICONS.shuffle}
          label={COPY.shuffle}
          onPress={() => playTracks({ tracks, source, isShuffled: true })}
        />
        <FavouriteToggle isOn={isFavourite} onToggle={() => favourite.mutate(!isFavourite)} />
      </View>
      {favourite.failure !== null && <Notice text={favourite.failure.message} />}
      {albumDiscsOf({ tracks, discCount }).map((disc) => (
        <View key={disc.key}>
          {disc.title !== null && (
            <Text accessibilityRole="header" style={styles.disc}>
              {disc.title}
            </Text>
          )}
          {disc.tracks.flatMap((row) => {
            const track = tracks[row.index]
            return track === undefined
              ? []
              : [
                  <TrackRow
                    isPlaying={row.id === playingId}
                    key={row.key}
                    label={row.label}
                    lead={row.number}
                    length={row.length}
                    line={null}
                    onPress={() => playTracks({ tracks, startAt: row.index, source })}
                    track={track}
                  />,
                ]
          })}
        </View>
      ))}
    </DetailPage>
  )
}

type ServerAlbumProps = { session: WrenSession; id: number | null }

function ServerAlbum({ session, id }: ServerAlbumProps) {
  const album = useQuery(session.queries.albumQuery(id))
  const page = routeState({ id, query: album })
  switch (page.state) {
    case ROUTE_STATES.missing:
      return <DetailNotice text={COPY.missing} />
    case ROUTE_STATES.error:
      return <DetailNotice text={page.message} />
    case ROUTE_STATES.loading:
      return <DetailNotice text={COPY.opening} />
    case ROUTE_STATES.ready:
      return <AlbumPage details={page.data} session={session} />
    default: {
      const unknown: never = page
      return unknown
    }
  }
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
    paddingTop: SIZES.space2,
  },
  pressed: { opacity: OPACITIES.pressed },
})
