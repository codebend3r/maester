import {
  type AlbumDetails,
  QUEUE_SOURCE_KINDS,
  ROUTE_STATES,
  type Track,
  formatDuration,
  plural,
  routeIdOf,
  routeState,
} from '@raven/core'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BUTTON_TONES, FormButton, ItemNotice, ToolButton } from '@/layouts'
import { Text } from '@/layouts/Text'
import { TouchBack } from '@/layouts/TouchBack'
import { pictureAt } from '@/queries/cards'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { APP_ROUTE_PARAMS, ROUTE_TARGETS, hrefOf } from '@/routes'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

const COPY = {
  opening: 'Opening the album',
  missing: 'This album is not on the server.',
  play: 'Play',
  shuffle: 'Shuffle',
  playNext: 'Play next',
  addToQueue: 'Add to queue',
  disc: (n: number) => `Disc ${n}`,
} as const

type TrackRowProps = {
  track: Track
  place: number
  isPlaying: boolean
  onPress: () => void
}

/** One track: its number, its title and its length, pressed to play the album from it. */
const TrackRow = ({ track, place, isPlaying, onPress }: TrackRowProps) => {
  const styles = useStyles()
  return (
    <Pressable
      accessibilityLabel={`${place}. ${track.title}`}
      accessibilityRole="button"
      accessibilityState={{ selected: isPlaying }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text style={[styles.number, isPlaying && styles.playing]}>
        {String(track.number ?? place)}
      </Text>
      <Text numberOfLines={1} style={[styles.rowTitle, isPlaying && styles.playing]}>
        {track.title}
      </Text>
      <Text style={styles.length}>{formatDuration(track.duration)}</Text>
    </Pressable>
  )
}

type AlbumPageProps = { session: AppQueries; details: AlbumDetails }

const AlbumPage = ({ session: { server, api }, details }: AlbumPageProps) => {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const styles = useStyles()
  const pictures = usePictures({ server, api })
  const playingId = useAudioQueue((store) => playingTrackOf(store)?.id ?? null)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const playNext = useAudioQueue((store) => store.playNext)
  const addToQueue = useAudioQueue((store) => store.addToQueue)
  const { album, tracks, discCount } = details
  const cover =
    pictures === null
      ? null
      : pictureAt({
          uri: api.albumCoverUrl({ albumId: album.id, coverVersion: album.coverVersion }),
          headersFor: pictures.headersFor,
        })
  const source = { kind: QUEUE_SOURCE_KINDS.album, id: album.id } as const
  const facts = [
    album.year === null ? null : String(album.year),
    plural({ n: album.trackCount, one: 'track', many: 'tracks' }),
    formatDuration(album.duration),
  ]
    .filter((fact): fact is string => fact !== null)
    .join(' · ')
  const discs = Array.from({ length: Math.max(1, discCount) }, (_, index) => index + 1)

  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        { paddingTop: insets.top + SIZES.space3, paddingBottom: insets.bottom + SIZES.space8 },
      ]}
      style={styles.ground}
    >
      <TouchBack onPress={() => router.back()} />
      <View style={styles.hero}>
        <View style={styles.cover}>
          {cover !== null && <Image source={cover} style={styles.coverPicture} />}
          {cover === null && <Text style={styles.initial}>{album.title.slice(0, 1)}</Text>}
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {album.title}
        </Text>
        {album.artists.map((artist) => (
          <Pressable
            key={artist.id}
            accessibilityRole="link"
            onPress={() => router.push(hrefOf({ kind: ROUTE_TARGETS.artist, artistId: artist.id }))}
          >
            <Text style={styles.artist}>{artist.name}</Text>
          </Pressable>
        ))}
        <Text style={styles.facts}>{facts}</Text>
        <View style={styles.actions}>
          <FormButton
            label={COPY.play}
            onPress={() => playTracks({ tracks, source })}
            tone={BUTTON_TONES.primary}
          />
          <FormButton
            label={COPY.shuffle}
            onPress={() => playTracks({ tracks, source, isShuffled: true })}
            tone={BUTTON_TONES.quiet}
          />
        </View>
        <View style={styles.actions}>
          <ToolButton
            accessibilityLabel={COPY.playNext}
            label={COPY.playNext}
            onPress={() => playNext(tracks)}
          />
          <ToolButton
            accessibilityLabel={COPY.addToQueue}
            label={COPY.addToQueue}
            onPress={() => addToQueue(tracks)}
          />
        </View>
      </View>
      {discs.map((disc) => (
        <View key={disc} style={styles.disc}>
          {discCount > 1 && <Text style={styles.discTitle}>{COPY.disc(disc)}</Text>}
          {tracks
            .filter((track) => (track.disc ?? 1) === disc)
            .map((track) => (
              <TrackRow
                key={track.id}
                isPlaying={playingId === track.id}
                onPress={() => playTracks({ tracks, startAt: tracks.indexOf(track), source })}
                place={tracks.indexOf(track) + 1}
                track={track}
              />
            ))}
        </View>
      ))}
    </ScrollView>
  )
}

type ServerAlbumProps = { session: AppQueries; id: number | null }

const ServerAlbum = ({ session, id }: ServerAlbumProps) => {
  const router = useRouter()
  const album = useQuery(session.queries.albumQuery(id))
  const page = routeState({ id, query: album })
  const back = () => router.back()
  switch (page.state) {
    case ROUTE_STATES.missing:
      return <ItemNotice notice={COPY.missing} onBack={back} />
    case ROUTE_STATES.error:
      return <ItemNotice notice={page.message} onBack={back} />
    case ROUTE_STATES.loading:
      return <ItemNotice notice={COPY.opening} onBack={back} />
    case ROUTE_STATES.ready:
      return <AlbumPage details={page.data} session={session} />
    default: {
      const unknown: never = page
      return unknown
    }
  }
}

/** `/album/[id]`: the cover, the artists and the facts, Play and Shuffle, and the tracks by disc. */
export const Album = () => {
  const session = useAppQueries()
  const params = useLocalSearchParams()
  const id = routeIdOf(params[APP_ROUTE_PARAMS.id])
  if (session === null) return null
  return <ServerAlbum key={session.server.id} id={id} session={session} />
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    page: { paddingHorizontal: SIZES.space4, gap: SIZES.space5 },
    hero: { alignItems: 'center', gap: SIZES.space2 },
    cover: {
      width: SIZES.cover,
      height: SIZES.cover,
      borderRadius: SIZES.radius,
      backgroundColor: colours.raised,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    coverPicture: { width: SIZES.cover, height: SIZES.cover },
    initial: { color: colours.muted, fontSize: SIZES.controlLarge },
    title: { color: colours.text, fontSize: SIZES.textXl, fontWeight: '600', textAlign: 'center' },
    artist: { color: colours.accent, fontSize: SIZES.text },
    facts: { color: colours.muted, fontSize: SIZES.textSm },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: SIZES.space2,
      justifyContent: 'center',
    },
    disc: { gap: SIZES.space1 },
    discTitle: { color: colours.muted, fontSize: SIZES.textSm, paddingVertical: SIZES.space1 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SIZES.space3,
      paddingVertical: SIZES.space2,
    },
    number: {
      color: colours.muted,
      fontSize: SIZES.textSm,
      width: SIZES.space5,
      textAlign: 'right',
    },
    rowTitle: { color: colours.text, fontSize: SIZES.text, flex: 1 },
    length: { color: colours.muted, fontSize: SIZES.textSm },
    playing: { color: colours.accent },
    pressed: { opacity: OPACITIES.pressed },
  }),
)
