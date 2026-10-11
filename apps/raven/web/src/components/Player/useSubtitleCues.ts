import { useQueries } from '@tanstack/react-query'
import { type SubtitleCue, type SubtitleTrack, mergeCues, subtitleWindows } from '@raven/core'
import { subtitlesQuery } from '@/lib/queries'

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
    queries:
      track == null
        ? []
        : windows.map((window) => subtitlesQuery({ id: mediaId, trackId: track.id, window })),
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
