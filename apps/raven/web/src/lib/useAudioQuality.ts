import {
  type AudioQuality,
  DOWNLOAD_STATUS_KINDS,
  TRACK_STREAM_KINDS,
  type Track,
  audioQualityOf,
} from '@raven/core'
import { useBrowserStream } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useAudioConnectionStatus } from '@/desktop/audioConnection'
import { downloadsQueryOf } from '@/desktop/downloadsApi'
import { CONNECTION_STATUSES } from '@/desktop/portConnection'
import { api } from '@/lib/api'
import { useDownloadsHostOrNone } from '@/stores/downloadsHost'

type PlayedQualityOfProps = {
  track: Track
  /** How the connection to Raven's music engine stands; null in a browser, which has none. */
  engine: ReturnType<typeof useAudioConnectionStatus>
  /**
   * The quality of what `useBrowserStream` says a browser's host plays: the file's or the
   * transcode's, or null while the libraries that tell a book from music are read.
   */
  streamed: AudioQuality | null
  /** Whether Raven holds a ready download of the track for the server in use. */
  hasDownload: boolean
}

/**
 * The quality of what the audio host plays, by the host's own decision. Raven's music engine
 * plays a ready download whatever bitrate is asked, and Raven downloads a track's original
 * file, so that is the file's quality, marked downloaded; it needs no server, so no libraries
 * either. Every other play is the browser's decision, which Raven's engine shares and the
 * page's own host makes where the engine is unavailable or lost: `streamed`, which is the file
 * or the transcode, and nothing while the libraries are read, which the host waits out. Nothing
 * plays while Raven's answer about its engine is on its way.
 */
export const playedQualityOf = ({
  track,
  engine,
  streamed,
  hasDownload,
}: PlayedQualityOfProps): AudioQuality | null => {
  if (engine === CONNECTION_STATUSES.waiting) return null
  if (engine === CONNECTION_STATUSES.native && hasDownload) {
    return {
      ...audioQualityOf({ track, stream: { kind: TRACK_STREAM_KINDS.file } }),
      isDownloaded: true,
    }
  }
  return streamed
}

type UseAudioQualityProps = { track: Track }

/**
 * The format and quality of the playing track as it really plays, in a browser and in Raven;
 * null until that is known. A download is asked after only while Raven's engine plays, since
 * nothing else plays one, and counts only for the server in use: main names a download's
 * `track` for no other.
 */
export const useAudioQuality = ({ track }: UseAudioQualityProps): AudioQuality | null => {
  const engine = useAudioConnectionStatus()
  const host = useDownloadsHostOrNone()
  const downloads = useQuery({
    ...downloadsQueryOf(host),
    enabled: engine === CONNECTION_STATUSES.native,
  })
  const stream = useBrowserStream({ api, track })
  const streamed = stream === null ? null : audioQualityOf({ track, stream })
  const hasDownload = (downloads.data?.downloads ?? []).some(
    (view) =>
      view.status.kind === DOWNLOAD_STATUS_KINDS.ready && (view.track?.id ?? null) === track.id,
  )
  return playedQualityOf({ track, engine, streamed, hasDownload })
}
