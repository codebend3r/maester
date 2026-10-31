import type { PlaylistDetails, PlaylistSummary, Track } from '@raven/core'
import { useServerPlaylistMutations } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { MUSIC_COPY } from '@/layouts/copy'
import { PLAYLIST_PICKS, type PlaylistPick } from '@/layouts/musicKit'
import type { AppQueries } from '@/queries/useAppQueries'

/** What Add to playlist offers while the account's playlists are on their way. */
const NO_PLAYLISTS: readonly PlaylistSummary[] = []

type UsePlaylistAddProps = { session: Pick<AppQueries, 'api' | 'queries'> }

type AddToPlaylistProps = { pick: PlaylistPick; tracks: readonly Track[] }

/**
 * Add to playlist, as the album page and Now Playing offer it: the account's playlists to pick
 * from, and the adding, to one of them or to a new one made first. `note` says where the tracks
 * went once they are in, or why they are not.
 */
export const usePlaylistAdd = ({ session: { api, queries } }: UsePlaylistAddProps) => {
  const playlists = useQuery(queries.ownPlaylistsQuery)
  const { create, append } = useServerPlaylistMutations({ api })
  const [note, setNote] = useState<string | null>(null)
  const told = {
    onSuccess: (details: PlaylistDetails) => setNote(MUSIC_COPY.added(details.playlist.name)),
    onError: (error: Error) => setNote(error.message),
  }
  const addToPlaylist = ({ pick, tracks }: AddToPlaylistProps) => {
    setNote(null)
    switch (pick.kind) {
      case PLAYLIST_PICKS.existing:
        return append.mutate({ id: pick.playlistId, tracks }, told)
      case PLAYLIST_PICKS.fresh:
        return create.mutate(pick.name, {
          onSuccess: (details) => append.mutate({ id: details.playlist.id, tracks }, told),
          onError: told.onError,
        })
      default: {
        const unknown: never = pick
        return unknown
      }
    }
  }
  return {
    playlists: playlists.data ?? NO_PLAYLISTS,
    addToPlaylist,
    note,
  }
}
