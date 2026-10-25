import { useEffect, useState } from 'react'

/**
 * The video layer keeps the last frame of the title before this one, and the page covers
 * it only while opaque. So the page lets the picture through once this title has a frame
 * of its own, which a mount per source makes once per title.
 */
export const useNativeSurface = ({ isWaiting }: { isWaiting: boolean }) => {
  const [hasFrame, setHasFrame] = useState(false)
  if (!hasFrame && !isWaiting) setHasFrame(true)
  useEffect(() => {
    if (!hasFrame) return
    document.documentElement.dataset.surface = 'native'
    return () => {
      delete document.documentElement.dataset.surface
    }
  }, [hasFrame])
}
