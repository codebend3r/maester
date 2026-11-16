import { useEffect, useRef } from 'react'
import { useAddressValue } from '@/lib/useAddressValue'
import { useUpcomingFilter } from '@/stores/upcomingFilter'

/** The address's search param that says requested titles are hidden, and the value it takes while they are. */
export const HIDE_REQUESTED_SEARCH = { name: 'hide', value: 'requested' } as const

type HideRequested = [boolean, (isHiding: boolean) => void]

/**
 * Whether a shelf page hides what is requested already, off at first. The
 * choice is kept on this device, so it holds from one shelf page to the
 * next, and the address says so while it is on (`?hide=requested`), so a
 * link or a reload keeps it. An address that says it as the page opens turns
 * the choice on; from then on the choice is what counts, and the address
 * follows it.
 */
export const useHideRequested = (): HideRequested => {
  const [asked, setAsked] = useAddressValue(HIDE_REQUESTED_SEARCH.name)
  const isHiding = useUpcomingFilter((state) => state.isHidingRequested)
  const setHiding = useUpcomingFilter((state) => state.setHidingRequested)
  const isAsked = asked === HIDE_REQUESTED_SEARCH.value
  // The address is read once, as the page opens: later it only follows, or a choice just unticked would tick itself again.
  const hasOpened = useRef(false)
  useEffect(() => {
    const isOpening = !hasOpened.current
    hasOpened.current = true
    if (isOpening && isAsked && !isHiding) {
      setHiding(true)
      return
    }
    if (isHiding !== isAsked) setAsked(isHiding ? HIDE_REQUESTED_SEARCH.value : null)
  }, [isAsked, isHiding, setHiding, setAsked])
  return [isHiding, setHiding]
}
