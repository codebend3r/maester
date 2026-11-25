import { useEffect, useRef } from 'react'
import { NavigationType, useLocation, useNavigationType } from 'react-router-dom'

/**
 * Starts a page opened by a press at its top, as a pushed screen starts in the apps. Going back
 * or forward keeps the browser's own place.
 */
export const useScrollReset = (): void => {
  const { pathname } = useLocation()
  const how = useNavigationType()
  const shown = useRef(pathname)
  useEffect(() => {
    if (shown.current === pathname) return
    shown.current = pathname
    if (how !== NavigationType.Pop) window.scrollTo(0, 0)
  }, [pathname, how])
}
