import type { SubtitleCue, SubtitleTrack } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import type { FileSubtitles } from '@/components/Player/engine'
import { SUBTITLE_STATUSES, type SubtitleStatus } from '@/lib/useTrackCues'

/** The cache key of one track of one local file, which its address names. */
const FILE_CUES_KEY = 'file-subtitles'

const NO_CUES: SubtitleCue[] = []

type UseFileCuesProps = {
  /** The file's address and the subtitles its host kept; null for a server's video. */
  file: { url: string; subtitles?: FileSubtitles } | null
  track: SubtitleTrack | null
}

type FileCues = { cues: SubtitleCue[]; status: SubtitleStatus }

/**
 * One track's cues for a local file, read whole from its host, which kept them beside the file.
 * No file, no kept subtitles or no track asks for nothing.
 */
export const useFileCues = ({ file, track }: UseFileCuesProps): FileCues => {
  const subtitles = file?.subtitles ?? null
  const trackId = track?.id ?? null
  const isAsked = subtitles !== null && trackId !== null
  const cues = useQuery({
    queryKey: [FILE_CUES_KEY, file?.url ?? null, trackId],
    queryFn: async () => (subtitles === null || trackId === null ? [] : subtitles.read(trackId)),
    enabled: isAsked,
    staleTime: Infinity,
    retry: false,
  })
  if (!isAsked) return { cues: NO_CUES, status: SUBTITLE_STATUSES.off }
  if (cues.isError) return { cues: NO_CUES, status: SUBTITLE_STATUSES.error }
  return {
    cues: cues.data ?? NO_CUES,
    status: cues.isPending ? SUBTITLE_STATUSES.loading : SUBTITLE_STATUSES.ready,
  }
}
