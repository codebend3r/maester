import {
  type PlaylistDetails,
  QUEUE_SOURCE_KINDS,
  ROUTE_STATES,
  type RouteQuery,
  routeIdOf,
  routeState,
} from '@raven/core'
import { playingTrackOf, useAudioQueue, useServerPlaylistMutations } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { ComponentType } from 'react'

import { PlaylistLayout } from '@/layouts'
import { playlistFactsOf, playlistTracksOf } from '@/layouts/musicRows'
import { movedUp, withoutPlace } from '@/music/playlistOrder'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { APP_ROUTE_PARAMS } from '@/routes'
import { PLAYLIST_COPY } from '@/screens/copy'
import { RouteError, RouteLoading, RouteMissing, type RouteViewProps } from '@/screens/RouteNotices'

type PlaylistPageProps = { session: AppQueries; details: PlaylistDetails }

const PlaylistPage = ({ session: { api }, details }: PlaylistPageProps) => {
  const router = useRouter()
  const playingId = useAudioQueue((store) => playingTrackOf(store)?.id ?? null)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const { rename, setTracks, remove } = useServerPlaylistMutations({ api })
  const { playlist, tracks } = details
  const source = { kind: QUEUE_SOURCE_KINDS.playlist, id: playlist.id } as const
  const failure = setTracks.failure ?? rename.failure ?? remove.error
  return (
    <PlaylistLayout
      facts={playlistFactsOf({ playlist })}
      name={playlist.name}
      note={failure === null ? null : PLAYLIST_COPY.failed(failure.message)}
      onBack={() => router.back()}
      onDelete={() => remove.mutate(playlist.id, { onSuccess: () => router.back() })}
      onMoveUp={(index) =>
        setTracks.mutate({ id: playlist.id, tracks: movedUp({ tracks, index }) })
      }
      onPlay={() => playTracks({ tracks, source })}
      onPlayFrom={(startAt) => playTracks({ tracks, startAt, source })}
      onRemove={(index) =>
        setTracks.mutate({ id: playlist.id, tracks: withoutPlace({ tracks, index }) })
      }
      onRename={(name) => rename.mutate({ id: playlist.id, name })}
      onShuffle={() => playTracks({ tracks, source, isShuffled: true })}
      playingId={playingId}
      tracks={playlistTracksOf({ tracks })}
    />
  )
}

type ServerPlaylistViewProps = RouteViewProps<PlaylistDetails> & { session: AppQueries }

type PlaylistReadyProps = ServerPlaylistViewProps

const PlaylistReady = ({ page, session }: PlaylistReadyProps) =>
  page.state === ROUTE_STATES.ready && <PlaylistPage details={page.data} session={session} />

/** What the page draws in each state its read is in. */
const SERVER_PLAYLIST_VIEWS = {
  [ROUTE_STATES.missing]: RouteMissing,
  [ROUTE_STATES.error]: RouteError,
  [ROUTE_STATES.loading]: RouteLoading,
  [ROUTE_STATES.ready]: PlaylistReady,
} as const satisfies Record<
  RouteQuery<PlaylistDetails>['state'],
  ComponentType<ServerPlaylistViewProps>
>

type ServerPlaylistProps = { session: AppQueries; id: number | null }

const ServerPlaylist = ({ session, id }: ServerPlaylistProps) => {
  const router = useRouter()
  const playlist = useQuery(session.queries.playlistQuery(id))
  const page = routeState({ id, query: playlist })
  const back = () => router.back()
  const PageView = SERVER_PLAYLIST_VIEWS[page.state]
  return <PageView copy={PLAYLIST_COPY} onBack={back} page={page} session={session} />
}

/**
 * `/playlist/[id]`: one of the account's playlists, played or shuffled from here, and under the
 * thumb renamed, deleted and its tracks moved up or taken out.
 */
export const Playlist = () => {
  const session = useAppQueries()
  const params = useLocalSearchParams()
  const id = routeIdOf(params[APP_ROUTE_PARAMS.id])
  return session !== null && <ServerPlaylist key={session.server.id} id={id} session={session} />
}
