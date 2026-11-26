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

/**
 * Every picture that arrived since the page opened, by its address, with how
 * wide it was laid out. Drawn again, as going back to a page draws its cards
 * anew, one is asked for at once and eagerly, at the width it had, so the
 * browser picks the same file from `srcSet` as before, which is in its
 * cache, and paints it with the page.
 */
const arrived = new Map<string, number>()

/** Whether `src` has arrived before, so whatever shows it can skip its stand-in. */
export const hasArrived = (src: string): boolean => arrived.has(src)

/** How a picture loads: one on its way when near the screen, one that arrived before at once. */
const LOADING = {
  near: { loading: 'lazy', decoding: 'async' },
  arrived: { loading: 'eager', decoding: 'auto' },
} as const

const stopWatching = (image: Element): void => {
  observer.unobserve(image)
  listeners.delete(image)
}

type ViewportImageProps = Omit<ComponentProps<'img'>, 'ref' | 'loading' | 'decoding' | 'alt'> & {
  src: string
  alt: string
}

/**
 * A listing's picture, asked for only once it nears the screen. One that
 * scrolls away before it arrives lets its request go, so a fast scroll
 * through thousands of covers spends the connection and the server's
 * scaling on the covers in view, not on every one it passed. One that
 * arrived is no longer watched, so it stays, and one that arrived before
 * is asked for at once. One on its way is lazy as well, which
 * `sizes="auto"` needs.
 */
const ViewportPicture = ({ src, srcSet, sizes, alt, onLoad, ...rest }: ViewportImageProps) => {
  const [arrivedWidth] = useState(() => arrived.get(src) ?? null)
  const [isNear, setNear] = useState(arrivedWidth !== null)
  const ref = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image || arrivedWidth !== null) return
      listeners.set(image, setNear)
      observer.observe(image)
      return () => stopWatching(image)
    },
    [arrivedWidth],
  )
  return (
    <img
      {...rest}
      ref={ref}
      src={isNear ? src : undefined}
      srcSet={isNear ? srcSet : undefined}
      sizes={arrivedWidth === null ? sizes : `${arrivedWidth}px`}
      alt={alt}
      {...(arrivedWidth === null ? LOADING.near : LOADING.arrived)}
      onLoad={(event) => {
        stopWatching(event.currentTarget)
        // A picture laid out at no width says nothing of the file to ask for again.
        const width = event.currentTarget.clientWidth
        if (width > 0) arrived.set(src, width)
        onLoad?.(event)
      }}
    />
  )
}

/** Drawn afresh for each address, so a new one is watched or remembered as its own. */
export const ViewportImage = (props: ViewportImageProps) => (
  <ViewportPicture key={props.src} {...props} />
)
