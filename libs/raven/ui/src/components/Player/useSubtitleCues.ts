import { useQueries } from '@tanstack/react-query'
import {
  PLAYER_SOURCE_KINDS,
  SUBTITLE_SOURCES,
  type SubtitleCue,
  type SubtitleTrack,
  mergeCues,
  subtitleWindows,
} from '@raven/core'
import type { HtmlSource } from '@/components/Player/engine'
import { playerQueriesFor } from '@/lib/playerQueries'

export type SubtitleStatus = 'off' | 'loading' | 'ready' | 'error'

/**
 * The cues around `time` for one track. An embedded track is fetched a
 * window at a time, the one playing plus the next as it draws near; a
 * sidecar file comes whole. Windows already fetched stay in the query
 * cache, so seeking back is instant.
 */
export const useSubtitleCues = ({
  source,
  track,
  time,
  duration,
}: {
  source: HtmlSource
  track: SubtitleTrack | null
  time: number
  duration: number | null
}): { cues: SubtitleCue[]; status: SubtitleStatus } => {
  const windows =
    track == null || source.kind === PLAYER_SOURCE_KINDS.file
      ? []
      : track.source === SUBTITLE_SOURCES.external
        ? [0]
        : subtitleWindows({ time, duration })
  return useQueries({
    queries:
      track == null || source.kind === PLAYER_SOURCE_KINDS.file
        ? []
        : windows.map((window) =>
            playerQueriesFor(source.api).subtitles({
              id: source.media.id,
              trackId: track.id,
              window,
            }),
          ),
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
