import { useEffect, useState } from 'react'

type OnScreen = {
  /** Give it to the element to watch. */
  ref: (element: Element | null) => void
  isOnScreen: boolean
}

/**
 * Whether an element is on the screen, or within `margin` of it, as a list
 * that reads more on scrolling asks before its end shows.
 */
export const useOnScreen = (margin: string): OnScreen => {
  const [element, setElement] = useState<Element | null>(null)
  const [isOnScreen, setIsOnScreen] = useState(false)
  useEffect(() => {
    if (element === null) return undefined
    const observer = new IntersectionObserver(
      (entries) => setIsOnScreen(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: margin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, margin])
  return { ref: setElement, isOnScreen }
}
