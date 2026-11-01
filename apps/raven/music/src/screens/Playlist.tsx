import { type PlaylistDetails, QUEUE_SOURCE_KINDS, routeIdOf } from '@raven/core'
import {
  playingTrackOf,
  playlistFactsOf,
  playlistTracksOf,
  useAudioQueue,
} from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'

import { PlayButtons } from '@/components/Controls'
import { BackButton, DetailRoute } from '@/components/DetailPage'
import { DownloadButton } from '@/components/DownloadButton'
import { Notice } from '@/components/Notice'
import { pageStyles, useListContent } from '@/components/TabPage'
import { TrackRow } from '@/components/TrackRow'
import { DOWNLOAD_SOURCES } from '@/downloads/downloadStore'
import { PLAYLIST_COPY } from '@/screens/copy'
import { WREN_ROUTE_PARAMS } from '@/routes'
import { PALETTE, SIZES } from '@/theme/wrenTheme'
import { type WrenSession, useWren } from '@/useWren'

type PlaylistPageProps = { session: WrenSession; details: PlaylistDetails }

function PlaylistPage({ session, details }: PlaylistPageProps) {
  const content = useListContent()
  const playingId = useAudioQueue((store) => playingTrackOf(store)?.id ?? null)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const { playlist, tracks } = details
  const source = { kind: QUEUE_SOURCE_KINDS.playlist, id: playlist.id } as const
  const [refusal, setRefusal] = useState<string | null>(null)
  return (
    <FlatList
      ListEmptyComponent={<Notice text={PLAYLIST_COPY.empty(playlist.name)} />}
      ListHeaderComponent={
        <View style={pageStyles.header}>
          <BackButton />
          <View style={styles.head}>
            <Text accessibilityRole="header" style={styles.title}>
              {playlist.name}
            </Text>
            <Text style={styles.facts}>{playlistFactsOf({ playlist })}</Text>
          </View>
          {tracks.length > 0 && (
            <View style={styles.actions}>
              <PlayButtons
                onPlay={() => playTracks({ tracks, source })}
                onShuffle={() => playTracks({ tracks, source, isShuffled: true })}
              />
              <DownloadButton
                collection={{ kind: DOWNLOAD_SOURCES.playlist, playlist }}
                onRefusal={setRefusal}
                serverId={session.server.id}
                tracks={tracks}
              />
            </View>
          )}
          {refusal !== null && <Notice text={refusal} />}
        </View>
      }
      contentContainerStyle={content}
      data={playlistTracksOf({ tracks })}
      keyExtractor={(row) => row.key}
      renderItem={({ item }) => {
        const track = tracks[item.index]
        return (
          track !== undefined && (
            <TrackRow
              isPlaying={item.id === playingId}
              label={item.label}
              lead={null}
              length={item.length}
              line={item.line}
              onPress={() => playTracks({ tracks, startAt: item.index, source })}
              track={track}
            />
          )
        )
      }}
      style={pageStyles.ground}
    />
  )
}

type ServerPlaylistProps = { session: WrenSession; id: number | null }

function ServerPlaylist({ session, id }: ServerPlaylistProps) {
  const playlist = useQuery(session.queries.playlistQuery(id))
  return (
    <DetailRoute copy={PLAYLIST_COPY} id={id} query={playlist}>
      {(details) => <PlaylistPage details={details} session={session} />}
    </DetailRoute>
  )
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SIZES.space2 },
})
