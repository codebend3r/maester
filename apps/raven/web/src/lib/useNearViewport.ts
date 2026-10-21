import { useCallback, useState } from 'react'

/**
 * How far past the screen's top and bottom an element counts as near: half
 * a screen, so a picture is on its way before a steady scroll reaches it,
 * yet far short of the browser's own lazy loading, which reaches more than a
 * thousand pixels ahead and asks for a whole grid's worth of covers at once.
 */
const MARGIN = '50% 0px'

type Watch = (isNear: boolean) => void

/** Who wants to know about each element: a library can list thousands, so they share one observer. */
const watches = new WeakMap<Element, Watch>()
const shared: { observer: IntersectionObserver | null } = { observer: null }

const sharedObserver = (): IntersectionObserver => {
  if (shared.observer) return shared.observer
  const observer = new IntersectionObserver(
    (entries) => entries.forEach((entry) => watches.get(entry.target)?.(entry.isIntersecting)),
    { rootMargin: MARGIN },
  )
  shared.observer = observer
  return observer
}

/**
 * Whether the element `ref` is given is on the screen or within half a
 * screen of it, kept up to date as the page scrolls; false until the first
 * reading.
 */
export const useNearViewport = () => {
  const [isNear, setNear] = useState(false)
  const ref = useCallback((element: Element | null) => {
    if (!element) return
    const observer = sharedObserver()
    watches.set(element, setNear)
    observer.observe(element)
    return () => {
      observer.unobserve(element)
      watches.delete(element)
    }
  }, [])
  return { ref, isNear }
}
