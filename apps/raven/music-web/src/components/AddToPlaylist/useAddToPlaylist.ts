import type { PlaylistSummary, Track } from '@raven/core'
import { useServerPlaylistMutations } from '@raven/ui/headless'
import { TRACK_MENU_COPY } from '@raven/wren'
import { api } from '@/lib/api'
import { useToast } from '@/stores/toast'

type UseAddToPlaylistProps = {
  /** What is added, read once a playlist is picked: a track, or an album's tracks. */
  tracksOf: () => Promise<readonly Track[]>
  /** Closes the sheet once a playlist is picked. */
  onDone: () => void
}

/** The playlist the tracks go to, as far as adding them reads it. */
export type PickedPlaylist = Pick<PlaylistSummary, 'id' | 'name'>

/**
 * Adds the tracks to the end of a picked playlist: the sheet closes at once, and once the server
 * has answered a toast says where they went, or why it refused.
 */
export const useAddToPlaylist = ({ tracksOf, onDone }: UseAddToPlaylistProps) => {
  const { append } = useServerPlaylistMutations({ api })
  const toast = useToast((state) => state.show)
  return (playlist: PickedPlaylist): void => {
    onDone()
    tracksOf()
      .then((tracks) => append.mutateAsync({ id: playlist.id, tracks }))
      .then(
        () => toast(TRACK_MENU_COPY.added(playlist.name)),
        (error: unknown) => error instanceof Error && toast(error.message),
      )
  }
}
