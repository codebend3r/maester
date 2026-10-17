import { useNavigate } from 'react-router-dom'
import { useCanGoBack } from '@/lib/useCanGoBack'

/**
 * Leaves the player as the browser's own Back would, for the page that
 * opened it, which comes back scrolled where it was. A player opened
 * straight from its address has no page of the app behind it: it goes to
 * `fallback` instead, rather than off the app.
 */
export const useLeave = (fallback: string): (() => void) => {
  const navigate = useNavigate()
  const canGoBack = useCanGoBack()
  return () => void (canGoBack ? navigate(-1) : navigate(fallback))
}
