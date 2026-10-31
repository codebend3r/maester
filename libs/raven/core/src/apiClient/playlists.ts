import type { Transport } from '@/apiClient/transport'
import {
  type PlaylistDetails,
  type PlaylistInput,
  type PlaylistSharing,
  type PlaylistSummary,
  type PlaylistTracksChange,
  isPlaylistDetails,
  isPlaylistList,
} from '@/contract'

type CreatePlaylistProps = PlaylistInput

type RenamePlaylistProps = { id: number } & PlaylistInput

type ReplacePlaylistTracksProps = { id: number } & PlaylistTracksChange

type AppendPlaylistTracksProps = { id: number } & PlaylistTracksChange

type SetPlaylistSharingProps = { id: number } & PlaylistSharing

type CopyPlaylistProps = { id: number }

/** The signed-in account's playlists and everyone's shared ones: listing, making, renaming, filling, sharing and copying them. */
export const playlistCalls = ({ send, expect }: Transport) => ({
  /** The account's playlists and every account's shared ones, most recently changed first. */
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

  /** Shares the account's own playlist with every account, or stops sharing it. */
  setPlaylistSharing: ({ id, isShared }: SetPlaylistSharingProps): Promise<PlaylistDetails> =>
    expect({
      request: send({
        path: `/api/playlists/${id}/sharing`,
        method: 'PUT',
        body: { isShared } satisfies PlaylistSharing,
      }),
      guard: isPlaylistDetails,
    }),

  /** Copies a playlist the account can see, its own or a shared one, into a new one of its own. */
  copyPlaylist: ({ id }: CopyPlaylistProps): Promise<PlaylistDetails> =>
    expect({
      request: send({ path: `/api/playlists/${id}/copy`, method: 'POST' }),
      guard: isPlaylistDetails,
    }),
})
