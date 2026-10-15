import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Leaves the player as the browser's own Back would, for the page that
 * opened it, which comes back scrolled where it was. A player opened
 * straight from its address has no page of the app behind it, and the
 * router keys that first entry "default": it goes to `fallback` instead,
 * rather than off the app.
 */
export const useLeave = (fallback: string): (() => void) => {
  const navigate = useNavigate()
  const isFirstEntry = useLocation().key === 'default'
  return () => void (isFirstEntry ? navigate(fallback) : navigate(-1))
}
