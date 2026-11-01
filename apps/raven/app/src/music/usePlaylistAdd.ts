import type { PlaylistSummary, Track } from '@raven/core'
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

type AppendToProps = { id: number; name: string; tracks: readonly Track[] }

/**
 * Add to playlist, as the album page and Now Playing offer it: the account's playlists to pick
 * from, and the adding, to one of them or to a new one made first. The tracks show in the playlist
 * at once, so `note` says where they went before the server answers, and why they are not there
 * if it refuses.
 */
export const usePlaylistAdd = ({ session: { api, queries } }: UsePlaylistAddProps) => {
  const playlists = useQuery(queries.ownPlaylistsQuery)
  const { create, append } = useServerPlaylistMutations({ api })
  const [note, setNote] = useState<string | null>(null)
  const appendTo = ({ id, name, tracks }: AppendToProps) => {
    setNote(MUSIC_COPY.added(name))
    append.attempt({ variables: { id, tracks }, onRefused: (error) => setNote(error.message) })
  }
  const addToPlaylist = ({ pick, tracks }: AddToPlaylistProps) => {
    setNote(null)
    switch (pick.kind) {
      case PLAYLIST_PICKS.existing:
        return appendTo({ id: pick.playlistId, name: pick.name, tracks })
      case PLAYLIST_PICKS.fresh:
        return create.mutate(pick.name, {
          onSuccess: (details) =>
            appendTo({ id: details.playlist.id, name: details.playlist.name, tracks }),
          onError: (error) => setNote(error.message),
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
