import { type AudioBitrate, TRACK_STREAM_KINDS, type Track, type TrackStream } from '@raven/core'
import { useTrackBitrate } from '@raven/ui/headless'
import { qualityLineOf } from '@raven/wren'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { queries } from '@/lib/queries'

/*
 * The stream the host's own decision makes: the transcode at `kbps`, or the file when it names
 * none. A browser plays nothing from a download, so the apps' third stream is never made here.
 */
const trackStreamOf = (kbps: AudioBitrate | null): TrackStream =>
  kbps === null ? { kind: TRACK_STREAM_KINDS.file } : { kind: TRACK_STREAM_KINDS.transcode, kbps }

type UseQualityProps = { track: Track }

/**
 * The format and quality line, from the decision `@raven/ui`'s `AudioHost` plays by: nothing
 * while the libraries that tell a book from music are read, which the host waits out before it
 * sets a source, then the file, or the transcode at the bitrate the prefs pick.
 */
export const useQuality = ({ track }: UseQualityProps): string | null => {
  const libraries = useQuery(queries.librariesQuery)
  const kbps = useTrackBitrate({ api, track })
  return libraries.isPending ? null : qualityLineOf({ track, stream: trackStreamOf(kbps) })
}
