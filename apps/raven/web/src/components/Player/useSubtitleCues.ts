import { useQueries } from '@tanstack/react-query'
import { type SubtitleCue, type SubtitleTrack, mergeCues, subtitleWindows } from '@raven/core'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'

export type SubtitleStatus = 'off' | 'loading' | 'ready' | 'error'

/**
 * The cues around `time` for one track. An embedded track is fetched a
 * window at a time, the one playing plus the next as it draws near; a
 * sidecar file comes whole. Windows already fetched stay in the query
 * cache, so seeking back is instant.
 */
export const useSubtitleCues = ({
  mediaId,
  track,
  time,
  duration,
}: {
  mediaId: number
  track: SubtitleTrack | null
  time: number
  duration: number | null
}): { cues: SubtitleCue[]; status: SubtitleStatus } => {
  const windows =
    track == null ? [] : track.source === 'external' ? [0] : subtitleWindows({ time, duration })
  return useQueries({
    queries: windows.map((window) => ({
      queryKey: queryKeys.subtitles({ id: mediaId, trackId: track?.id ?? '', window }),
      queryFn: () => api.getSubtitles({ id: mediaId, trackId: track?.id ?? '', window }),
      staleTime: Infinity,
      gcTime: 30 * 60 * 1000,
      retry: 1,
    })),
    combine: (results) => {
      const [playing] = results
      const status: SubtitleStatus =
        playing == null
          ? 'off'
          : playing.isError
            ? 'error'
            : playing.isPending
              ? 'loading'
              : 'ready'
      const cues = results.reduce<SubtitleCue[]>(
        (merged, result) =>
          result.data ? mergeCues({ existing: merged, incoming: result.data }) : merged,
        [],
      )
      return { cues, status }
    },
  })
}
