import { useLocation, useNavigate } from 'react-router-dom'

/** The key react-router gives the first page of a visit, which has nothing behind it. */
const FIRST_PAGE_KEY = 'default'

type UseGoBackProps = {
  /** Where back goes when the page was opened by its address, with no page behind it. */
  fallback: string
}

/**
 * The way back from a page opened from another: to the page behind it, or to `fallback` when
 * there is none, as on a page opened from a link or the sidebar's own address.
 */
export const useGoBack = ({ fallback }: UseGoBackProps): (() => void) => {
  const navigate = useNavigate()
  const { key } = useLocation()
  return () => {
    if (key === FIRST_PAGE_KEY) {
      navigate(fallback, { replace: true })
      return
    }
    navigate(-1)
  }
}
