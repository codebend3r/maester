import type { Track } from '@raven/core'
import { useBrowserStream } from '@raven/ui/headless'
import { qualityLineOf } from '@raven/wren'
import { api } from '@/lib/api'

type UseQualityProps = { track: Track }

/**
 * The format and quality line, from the stream `@raven/ui`'s `AudioHost` plays: nothing while
 * the libraries that tell a book from music are read, then the file or the transcode.
 */
export const useQuality = ({ track }: UseQualityProps): string | null => {
  const stream = useBrowserStream({ api, track })
  return stream === null ? null : qualityLineOf({ track, stream })
}
