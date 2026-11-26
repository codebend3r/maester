import type { Track } from '@raven/core'
import { tracksOfPages } from '@raven/wren'
import { useQueryClient } from '@tanstack/react-query'

import type { WrenSession } from '@/useWren'

type UseAlbumTracksProps = Pick<WrenSession, 'queries'>

/**
 * Reads albums' tracks only once something plays or queues them: every track of `albumIds`, in
 * the albums' order, each album read through the cache its own page fills.
 */
export const useAlbumTracks = ({ queries }: UseAlbumTracksProps) => {
  const queryClient = useQueryClient()
  return async (albumIds: readonly number[]): Promise<readonly Track[]> => {
    const pages = await Promise.all(
      albumIds.map((id) => queryClient.fetchQuery(queries.albumQuery(id))),
    )
    return tracksOfPages(pages)
  }
}
