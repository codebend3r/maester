import {
  type PlaylistDetails,
  QUEUE_SOURCE_KINDS,
  ROUTE_STATES,
  routeIdOf,
  routeState,
} from '@raven/core'
import {
  playingTrackOf,
  playlistFactsOf,
  playlistTracksOf,
  useAudioQueue,
} from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

import { ActionButton } from '@/components/Controls'
import { DetailNotice, DetailPage } from '@/components/DetailPage'
import { Notice } from '@/components/Notice'
import { TrackRow } from '@/components/TrackRow'
import { WREN_ROUTE_PARAMS } from '@/routes'
import { WREN_ICONS } from '@/theme/icons'
import { PALETTE, SIZES } from '@/theme/wrenTheme'
import { type WrenSession, useWren } from '@/useWren'

const COPY = {
  opening: 'Opening the playlist',
  missing: 'This playlist is not on the server.',
  play: 'Play',
  shuffle: 'Shuffle',
  empty: (name: string) => `Nothing in ${name} yet. Add songs from any track's menu.`,
} as const

type PlaylistPageProps = { details: PlaylistDetails }

function PlaylistPage({ details }: PlaylistPageProps) {
  const playingId = useAudioQueue((store) => playingTrackOf(store)?.id ?? null)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const { playlist, tracks } = details
  const source = { kind: QUEUE_SOURCE_KINDS.playlist, id: playlist.id } as const
  return (
    <DetailPage>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={styles.title}>
          {playlist.name}
        </Text>
        <Text style={styles.facts}>{playlistFactsOf({ playlist })}</Text>
      </View>
      {tracks.length === 0 ? (
        <Notice text={COPY.empty(playlist.name)} />
      ) : (
        <>
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
          </View>
          <View>
            {playlistTracksOf({ tracks }).flatMap((row) => {
              const track = tracks[row.index]
              return track === undefined
                ? []
                : [
                    <TrackRow
                      isPlaying={row.id === playingId}
                      key={row.key}
                      label={row.label}
                      lead={null}
                      length={row.length}
                      line={row.line}
                      onPress={() => playTracks({ tracks, startAt: row.index, source })}
                      track={track}
                    />,
                  ]
            })}
          </View>
        </>
      )}
    </DetailPage>
  )
}

type ServerPlaylistProps = { session: WrenSession; id: number | null }

function ServerPlaylist({ session, id }: ServerPlaylistProps) {
  const playlist = useQuery(session.queries.playlistQuery(id))
  const page = routeState({ id, query: playlist })
  switch (page.state) {
    case ROUTE_STATES.missing:
      return <DetailNotice text={COPY.missing} />
    case ROUTE_STATES.error:
      return <DetailNotice text={page.message} />
    case ROUTE_STATES.loading:
      return <DetailNotice text={COPY.opening} />
    case ROUTE_STATES.ready:
      return <PlaylistPage details={page.data} />
    default: {
      const unknown: never = page
      return unknown
    }
  }
}

/** `/playlist/[id]`: one of the listener's playlists, played or shuffled from here. */
export function Playlist() {
  const session = useWren()
  const params = useLocalSearchParams()
  const id = routeIdOf(params[WREN_ROUTE_PARAMS.id])
  return session !== null && <ServerPlaylist id={id} session={session} />
}

const styles = StyleSheet.create({
  head: { gap: SIZES.space1 },
  title: { color: PALETTE.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  facts: { color: PALETTE.muted, fontSize: SIZES.textSm },
  actions: { flexDirection: 'row', gap: SIZES.space2 },
})
