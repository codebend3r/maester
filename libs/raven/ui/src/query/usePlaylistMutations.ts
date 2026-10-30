import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient, PlaylistDetails, PlaylistSummary, Track } from '@raven/core'
import { playlistRenameEdits, playlistTracksEdits } from '@/query/edits'
import { afterPlaylists } from '@/query/invalidate'
import { useOptimisticMutation } from '@/query/optimistic'
import { mutationKeys, queryKeys } from '@/query/queryClient'

type RenameProps = { id: number; name: string }

type SetTracksProps = { id: number; tracks: readonly Track[] }

type AppendProps = { id: number; tracks: readonly Track[] }

type UseServerPlaylistMutationsProps = { api: ApiClient }

/**
 * Everything done to the account's playlists. A rename and a new order (a
 * track moved or taken out) show before the server answers and go to it one
 * at a time; making, deleting and adding tracks wait for the answer, which
 * fills the playlist's page. The list of playlists is read again after each.
 */
export const useServerPlaylistMutations = ({ api }: UseServerPlaylistMutationsProps) => {
  const queryClient = useQueryClient()
  // The answer is the playlist's page as it now stands, so only the list is read again.
  const readList = (): Promise<unknown> =>
    queryClient.invalidateQueries({ queryKey: queryKeys.playlistList })
  const keep = (details: PlaylistDetails): Promise<unknown> => {
    queryClient.setQueryData(queryKeys.playlist(details.playlist.id), details)
    return readList()
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

  const append = useMutation({
    mutationFn: ({ id, tracks }: AppendProps) =>
      api.appendPlaylistTracks({ id, mediaIds: tracks.map((track) => track.id) }),
    onSuccess: keep,
  })

  const remove = useMutation({
    mutationFn: (id: number) => api.deletePlaylist(id),
    onSuccess: (_answer, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.playlist(id), exact: true })
      queryClient.setQueryData<PlaylistSummary[]>(queryKeys.playlistList, (playlists) =>
        playlists === undefined ? undefined : playlists.filter((playlist) => playlist.id !== id),
      )
      return readList()
    },
  })

  return { create, rename, setTracks, append, remove }
}

type PlaylistMutationsForProps = { api: ApiClient }

/** The playlist hook over one server's `api`, for a host with one server. */
export const playlistMutationsFor = ({ api }: PlaylistMutationsForProps) => ({
  usePlaylistMutations: () => useServerPlaylistMutations({ api }),
})
