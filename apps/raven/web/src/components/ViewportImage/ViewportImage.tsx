import { type ComponentProps, useState } from 'react'
import { useNearViewport } from '@/lib/useNearViewport'

/**
 * A listing's picture, asked for only once it nears the screen. One that
 * scrolls away before it arrives lets its request go, so a fast scroll
 * through thousands of covers spends the connection and the server's
 * scaling on the covers in view, not on every one it passed. A picture that
 * arrived stays. It is lazy as well, which `sizes="auto"` needs.
 */
export const ViewportImage = ({
  src,
  srcSet,
  alt,
  onLoad,
  ...rest
}: Omit<ComponentProps<'img'>, 'ref' | 'loading' | 'decoding' | 'alt'> & {
  src: string
  alt: string
}) => {
  const { ref, isNear } = useNearViewport()
  const [isLoaded, setLoaded] = useState(false)
  const shouldLoad = isNear || isLoaded
  return (
    <img
      {...rest}
      ref={ref}
      src={shouldLoad ? src : undefined}
      srcSet={shouldLoad ? srcSet : undefined}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={(event) => {
        setLoaded(true)
        onLoad?.(event)
      }}
    />
  )
}
