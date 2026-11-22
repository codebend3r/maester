import { useState } from 'react'
import type { Cover } from '@/music/useCovers'

type UsePictureProps = {
  /** The server's picture, or null while it has none. */
  picture: Cover | null
}

/**
 * A picture to draw, or null when there is none or it would not load, so what stands in for it
 * shows instead of a broken image. `onError` is the `<img>`'s; a new address is tried afresh.
 */
export const usePicture = ({ picture }: UsePictureProps) => {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const src = picture === null || picture.src === failedSrc ? null : picture.src
  return { src, onError: () => setFailedSrc(src) }
}
