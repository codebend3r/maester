import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import {
  type PlaylistDetails,
  type PlaylistInput,
  type PlaylistSharing,
  type PlaylistSummary,
  type PlaylistTracksChange,
} from '@/contract'

type CreatePlaylistProps = PlaylistInput

type RenamePlaylistProps = { id: number } & PlaylistInput

type ReplacePlaylistTracksProps = { id: number } & PlaylistTracksChange

type AppendPlaylistTracksProps = { id: number } & PlaylistTracksChange

type SetPlaylistSharingProps = { id: number } & PlaylistSharing

type CopyPlaylistProps = { id: number }

/** The signed-in account's playlists and everyone's shared ones: listing, making, renaming, filling, sharing and copying them. */
export const playlistCalls = ({ ask, tell }: Transport) => ({
  /** The account's playlists and every account's shared ones, most recently changed first. */
  listPlaylists: (): Promise<PlaylistSummary[]> => ask({ route: ROUTES.listPlaylists }),

  /** Makes an empty playlist and answers with its page. */
  createPlaylist: ({ name }: CreatePlaylistProps): Promise<PlaylistDetails> =>
    ask({ route: ROUTES.createPlaylist, body: { name } satisfies PlaylistInput }),

  /** A playlist with its tracks in order; those the account may not see are left out. */
  getPlaylist: (id: number): Promise<PlaylistDetails> =>
    ask({ route: ROUTES.getPlaylist, params: { id } }),

  renamePlaylist: ({ id, name }: RenamePlaylistProps): Promise<PlaylistDetails> =>
    ask({ route: ROUTES.renamePlaylist, params: { id }, body: { name } satisfies PlaylistInput }),

  deletePlaylist: async (id: number): Promise<void> => {
    await tell({ route: ROUTES.deletePlaylist, params: { id } })
  },

  /** Puts `mediaIds` in place of the playlist's tracks, in that order: how a track is moved or removed. */
  replacePlaylistTracks: ({ id, mediaIds }: ReplacePlaylistTracksProps): Promise<PlaylistDetails> =>
    ask({
      route: ROUTES.replacePlaylistTracks,
      params: { id },
      body: { mediaIds } satisfies PlaylistTracksChange,
    }),

  /** Adds `mediaIds` at the playlist's end, in that order. */
  appendPlaylistTracks: ({ id, mediaIds }: AppendPlaylistTracksProps): Promise<PlaylistDetails> =>
    ask({
      route: ROUTES.appendPlaylistTracks,
      params: { id },
      body: { mediaIds } satisfies PlaylistTracksChange,
    }),

  /** Shares the account's own playlist with every account, or stops sharing it. */
  setPlaylistSharing: ({ id, isShared }: SetPlaylistSharingProps): Promise<PlaylistDetails> =>
    ask({
      route: ROUTES.setPlaylistSharing,
      params: { id },
      body: { isShared } satisfies PlaylistSharing,
    }),

  /** Copies a playlist the account can see, its own or a shared one, into a new one of its own. */
  copyPlaylist: ({ id }: CopyPlaylistProps): Promise<PlaylistDetails> =>
    ask({ route: ROUTES.copyPlaylist, params: { id } }),
})
