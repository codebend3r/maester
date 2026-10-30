import type { Transport } from '@/apiClient/transport'
import {
  type PlaylistDetails,
  type PlaylistInput,
  type PlaylistSummary,
  type PlaylistTracksChange,
  isPlaylistDetails,
  isPlaylistList,
} from '@/contract'

type CreatePlaylistProps = PlaylistInput

type RenamePlaylistProps = { id: number } & PlaylistInput

type ReplacePlaylistTracksProps = { id: number } & PlaylistTracksChange

type AppendPlaylistTracksProps = { id: number } & PlaylistTracksChange

/** The signed-in account's own playlists: listing, making, renaming and filling them. */
export const playlistCalls = ({ send, expect }: Transport) => ({
  /** The account's playlists, most recently changed first. */
  listPlaylists: (): Promise<PlaylistSummary[]> =>
    expect({ request: send({ path: '/api/playlists' }), guard: isPlaylistList }),

  /** Makes an empty playlist and answers with its page. */
  createPlaylist: ({ name }: CreatePlaylistProps): Promise<PlaylistDetails> =>
    expect({
      request: send({
        path: '/api/playlists',
        method: 'POST',
        body: { name } satisfies PlaylistInput,
      }),
      guard: isPlaylistDetails,
    }),

  /** A playlist with its tracks in order; those the account may not see are left out. */
  getPlaylist: (id: number): Promise<PlaylistDetails> =>
    expect({ request: send({ path: `/api/playlists/${id}` }), guard: isPlaylistDetails }),

  renamePlaylist: ({ id, name }: RenamePlaylistProps): Promise<PlaylistDetails> =>
    expect({
      request: send({
        path: `/api/playlists/${id}`,
        method: 'PUT',
        body: { name } satisfies PlaylistInput,
      }),
      guard: isPlaylistDetails,
    }),

  deletePlaylist: async (id: number): Promise<void> => {
    await send({ path: `/api/playlists/${id}`, method: 'DELETE' })
  },

  /** Puts `mediaIds` in place of the playlist's tracks, in that order: how a track is moved or removed. */
  replacePlaylistTracks: ({ id, mediaIds }: ReplacePlaylistTracksProps): Promise<PlaylistDetails> =>
    expect({
      request: send({
        path: `/api/playlists/${id}/tracks`,
        method: 'PUT',
        body: { mediaIds } satisfies PlaylistTracksChange,
      }),
      guard: isPlaylistDetails,
    }),

  /** Adds `mediaIds` at the playlist's end, in that order. */
  appendPlaylistTracks: ({ id, mediaIds }: AppendPlaylistTracksProps): Promise<PlaylistDetails> =>
    expect({
      request: send({
        path: `/api/playlists/${id}/tracks`,
        method: 'POST',
        body: { mediaIds } satisfies PlaylistTracksChange,
      }),
      guard: isPlaylistDetails,
    }),
})
