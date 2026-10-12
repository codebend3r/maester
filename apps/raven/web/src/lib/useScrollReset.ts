import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/**
 * A page opened by a link starts at its top, rather than wherever the last
 * one was scrolled to. Back and forward leave the scroll to the browser.
 * A change to the address's query alone, as a sort or search writes, is the
 * same page, so it stays put.
 */
export const useScrollReset = (): void => {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()
  const shown = useRef(pathname)
  useEffect(() => {
    if (shown.current === pathname) return
    shown.current = pathname
    if (navigationType !== 'POP') window.scrollTo({ top: 0 })
  }, [pathname, navigationType])
}
