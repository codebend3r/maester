import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient, PlaylistDetails, Track } from '@raven/core'
import {
  playlistAppendEdits,
  playlistDeleteEdits,
  playlistRenameEdits,
  playlistTracksEdits,
} from '@/query/edits'
import { afterPlaylists } from '@/query/invalidate'
import { useOptimisticMutation } from '@/query/optimistic'
import { mutationKeys, queryKeys } from '@/query/queryClient'

type RenameProps = { id: number; name: string }

type SetTracksProps = { id: number; tracks: readonly Track[] }

type AppendProps = { id: number; tracks: readonly Track[] }

type ShareProps = { id: number; isShared: boolean }

type UseServerPlaylistMutationsProps = { api: ApiClient }

/**
 * Everything done to the account's playlists. A rename, a new order (a track
 * moved or taken out), tracks added and a playlist deleted show before the
 * server answers and go to it one at a time; making, sharing and copying wait
 * for the answer, which fills the playlist's page (the copy's, for a copy).
 * The list of playlists is read again after each, without holding up the change.
 */
export const useServerPlaylistMutations = ({ api }: UseServerPlaylistMutationsProps) => {
  const queryClient = useQueryClient()
  // The answer is the new playlist's page, so only the list is read again, and
  // not waited on: the caller goes on with the playlist as soon as it exists.
  const keep = (details: PlaylistDetails) => {
    queryClient.setQueryData(queryKeys.playlist(details.playlist.id), details)
    queryClient.invalidateQueries({ queryKey: queryKeys.playlistList }).catch(() => undefined)
  }
  const create = useMutation({
    mutationFn: (name: string) => api.createPlaylist({ name }),
    onSuccess: keep,
  })

  const rename = useOptimisticMutation({
    mutationKey: mutationKeys.playlist,
    mutationFn: ({ id, name }: RenameProps) => api.renamePlaylist({ id, name }),
    edits: ({ id, name }) => playlistRenameEdits({ id, name }),
    settle: () => afterPlaylists(queryClient),
  })

  const setTracks = useOptimisticMutation({
    mutationKey: mutationKeys.playlist,
    mutationFn: ({ id, tracks }: SetTracksProps) =>
      api.replacePlaylistTracks({ id, mediaIds: tracks.map((track) => track.id) }),
    edits: ({ id, tracks }) => playlistTracksEdits({ id, tracks }),
    settle: () => afterPlaylists(queryClient),
  })

  const append = useOptimisticMutation({
    mutationKey: mutationKeys.playlist,
    mutationFn: ({ id, tracks }: AppendProps) =>
      api.appendPlaylistTracks({ id, mediaIds: tracks.map((track) => track.id) }),
    edits: ({ id, tracks }) => playlistAppendEdits({ id, tracks }),
    settle: () => afterPlaylists(queryClient),
  })

  const remove = useOptimisticMutation({
    mutationKey: mutationKeys.playlist,
    mutationFn: async (id: number) => {
      await api.deletePlaylist(id)
      queryClient.removeQueries({ queryKey: queryKeys.playlist(id), exact: true })
    },
    edits: (id) => playlistDeleteEdits({ id }),
    settle: () => afterPlaylists(queryClient),
  })

  const share = useMutation({
    mutationFn: ({ id, isShared }: ShareProps) => api.setPlaylistSharing({ id, isShared }),
    onSuccess: keep,
  })

  const copy = useMutation({
    mutationFn: (id: number) => api.copyPlaylist({ id }),
    onSuccess: keep,
  })

  return { create, rename, setTracks, append, remove, share, copy }
}

type PlaylistMutationsForProps = { api: ApiClient }

/** The playlist hook over one server's `api`, for a host with one server. */
export const playlistMutationsFor = ({ api }: PlaylistMutationsForProps) => ({
  usePlaylistMutations: () => useServerPlaylistMutations({ api }),
})
