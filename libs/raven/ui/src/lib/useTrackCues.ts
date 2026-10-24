import { useQueries } from '@tanstack/react-query'
import {
  type ApiClient,
  SUBTITLE_SOURCES,
  type SubtitleCue,
  type SubtitleTrack,
  mergeCues,
  subtitleWindows,
} from '@raven/core'
import { playerQueriesFor } from '@/lib/playerQueries'

/** Where a track's cues stand: none asked for, on their way, read, or refused. */
const SUBTITLE_STATUSES = {
  off: 'off',
  loading: 'loading',
  ready: 'ready',
  error: 'error',
} as const

export type SubtitleStatus = (typeof SUBTITLE_STATUSES)[keyof typeof SUBTITLE_STATUSES]

/**
 * The cues around `time` for one track of a server's video, from its WebVTT route. An embedded
 * track is fetched a window at a time, the one playing plus the next as it draws near; a sidecar
 * file comes whole. Windows already fetched stay in the query cache, so seeking back is instant.
 * No video (a local file) or no track asks for nothing.
 */
export const useTrackCues = ({
  video,
  track,
  time,
  duration,
}: {
  video: { api: ApiClient; mediaId: number } | null
  track: SubtitleTrack | null
  time: number
  duration: number | null
}): { cues: SubtitleCue[]; status: SubtitleStatus } => {
  const queries = (() => {
    if (track == null || video == null) return []
    const windows =
      track.source === SUBTITLE_SOURCES.external ? [0] : subtitleWindows({ time, duration })
    const { subtitles } = playerQueriesFor(video.api)
    return windows.map((window) => subtitles({ id: video.mediaId, trackId: track.id, window }))
  })()
  return useQueries({
    queries,
    combine: (results) => {
      const [playing] = results
      const status = (() => {
        if (playing == null) return SUBTITLE_STATUSES.off
        if (playing.isError) return SUBTITLE_STATUSES.error
        return playing.isPending ? SUBTITLE_STATUSES.loading : SUBTITLE_STATUSES.ready
      })()
      const cues = results.reduce<SubtitleCue[]>(
        (merged, result) =>
          result.data ? mergeCues({ existing: merged, incoming: result.data }) : merged,
        [],
      )
      return { cues, status }
    },
  })
}
