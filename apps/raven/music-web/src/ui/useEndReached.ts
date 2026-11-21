import { type RefObject, useEffect, useRef } from 'react'

/** How far under the screen the list's end is still counted as near: about a screen's worth of rows. */
const END_MARGIN = '0px 0px 800px 0px'

type UseEndReachedProps = {
  /** What the list does as its end nears: ask for the next page. */
  onEndReached: () => void
  /** How many entries the list holds, so an end still near after a page asks again. */
  count: number
}

/**
 * A mark to put after a list's last row: as it nears the screen, `onEndReached` is told, as the
 * apps' lists tell theirs. It is told again after each page while the end is still near, since a
 * mark that never left the screen would otherwise say nothing more.
 */
export const useEndReached = ({
  onEndReached,
  count,
}: UseEndReachedProps): RefObject<HTMLDivElement | null> => {
  const end = useRef<HTMLDivElement>(null)
  const latest = useRef(onEndReached)
  useEffect(() => {
    latest.current = onEndReached
  })
  useEffect(() => {
    const target = end.current
    // A list holding nothing yet has no end to near: its first page comes by itself.
    if (target === null || count === 0) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(({ isIntersecting }) => isIntersecting)) latest.current()
      },
      { rootMargin: END_MARGIN },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [count])
  return end
}
