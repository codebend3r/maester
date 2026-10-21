import { type ComponentProps, useCallback, useState } from 'react'

/**
 * Who hears when each picture nears the screen: a library can list
 * thousands, so they share one observer. Near is on the screen or within
 * half a screen of its top or bottom, so a picture is on its way before a
 * steady scroll reaches it, yet far short of the browser's own lazy
 * loading, which reaches more than a thousand pixels ahead and asks for a
 * whole grid's worth of covers at once.
 */
const listeners = new WeakMap<Element, (isNear: boolean) => void>()
const observer = new IntersectionObserver(
  (entries) => entries.forEach((entry) => listeners.get(entry.target)?.(entry.isIntersecting)),
  { rootMargin: '50% 0px' },
)

const stopWatching = (image: Element): void => {
  observer.unobserve(image)
  listeners.delete(image)
}

/**
 * A listing's picture, asked for only once it nears the screen. One that
 * scrolls away before it arrives lets its request go, so a fast scroll
 * through thousands of covers spends the connection and the server's
 * scaling on the covers in view, not on every one it passed. One that
 * arrived is no longer watched, so it stays. It is lazy as well, which
 * `sizes="auto"` needs.
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
  const [isNear, setNear] = useState(false)
  const ref = useCallback((image: HTMLImageElement | null) => {
    if (!image) return
    listeners.set(image, setNear)
    observer.observe(image)
    return () => stopWatching(image)
  }, [])
  return (
    <img
      {...rest}
      ref={ref}
      src={isNear ? src : undefined}
      srcSet={isNear ? srcSet : undefined}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={(event) => {
        stopWatching(event.currentTarget)
        onLoad?.(event)
      }}
    />
  )
}
