import { type RefObject, useLayoutEffect, useRef } from 'react'

/** Where the list starts down the page, which the stylesheet fits the A to Z rail under. */
const LIST_START = '--list-start'

type UseListStartProps = {
  /** Whether the listing is drawn, so it is measured as soon as it is. */
  isShown: boolean
}

type ListStart = {
  /** Goes on the listing, which is told where it starts. */
  listing: RefObject<HTMLDivElement | null>
  /** Goes on the header over the listing, whose height moves it. */
  header: RefObject<HTMLDivElement | null>
}

/**
 * Names on the listing how far down the page it starts, and again whenever the header over it
 * or the page changes size: a stylesheet cannot know how tall the header stands, and the rail
 * fits between there and the shell's bars.
 */
export const useListStart = ({ isShown }: UseListStartProps): ListStart => {
  const listing = useRef<HTMLDivElement>(null)
  const header = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = listing.current
    if (!isShown || element === null) return undefined
    const measure = () => {
      const start = element.getBoundingClientRect().top + window.scrollY
      element.style.setProperty(LIST_START, `${start}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    const around = [element.parentElement, header.current]
    around.filter((it) => it !== null).forEach((it) => observer.observe(it))
    return () => observer.disconnect()
  }, [isShown])
  return { listing, header }
}
