import { type AudioQuality, type Track, audioQualityOf } from '@raven/core'
import { useBrowserStream } from '@raven/ui/headless'
import { api } from '@/lib/api'

type UseQualityProps = { track: Track }

/**
 * The format and quality of what `@raven/ui`'s `AudioHost` plays: nothing while the libraries
 * that tell a book from music are read, then the file's, or the transcode's at the bitrate the
 * prefs pick.
 */
export const useQuality = ({ track }: UseQualityProps): AudioQuality | null => {
  const stream = useBrowserStream({ api, track })
  return stream === null ? null : audioQualityOf({ track, stream })
}
