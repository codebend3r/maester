import { type Search, useSearch } from '@raven/ui/headless'
import { useDeferredValue, useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { PAGE_PARAMS } from '@/lib/appPaths'
import { handled } from '@/lib/handled'

type UseAddressSearchProps = {
  page?: string
  /** The address follows only what Enter asked for, or an emptied box, while the box suggests on the pause. */
  shouldWaitForEnter?: boolean
}

/**
 * A search that rides in the address as `?q=`, so a refresh, a shared link
 * or Back lands on it again. The query is written once it settles,
 * replacing the entry rather than stacking one per pause, and an address
 * the box did not write, as the side menu's link back to the page, puts its
 * search in the box. Given a `page`, the box searches that page from
 * anywhere: elsewhere it starts empty, and a query settling there opens the
 * page on it. With `shouldWaitForEnter` the address waits for Enter instead of
 * the pause, so a box that offers suggestions as its viewer types leaves the
 * page alone until they pick one or ask for every result.
 */
export const useAddressSearch = ({
  page,
  shouldWaitForEnter = false,
}: UseAddressSearchProps = {}): Search => {
  const [address, setAddress] = useSearchParams()
  const navigate = useNavigate()
  const { key, pathname } = useLocation()
  const away = page != null && pathname !== page ? page : null
  const asked = away == null ? (address.get(PAGE_PARAMS.search) ?? '') : ''
  const search = useSearch({ initial: asked })
  const { query, committed, searchFor } = search
  const followed = shouldWaitForEnter ? committed : query
  // Let a queued navigation commit before a local query can replace its address.
  const deferredQuery = useDeferredValue(followed)

  useEffect(() => {
    if (deferredQuery !== followed || deferredQuery === asked) return
    if (away != null) {
      handled(
        Promise.resolve(
          navigate(`${away}?${new URLSearchParams({ [PAGE_PARAMS.search]: deferredQuery })}`),
        ),
      )
      return
    }
    setAddress(
      (current) => {
        const next = new URLSearchParams(current)
        if (deferredQuery) next.set(PAGE_PARAMS.search, deferredQuery)
        else next.delete(PAGE_PARAMS.search)
        return next
      },
      { replace: true },
    )
  }, [asked, away, followed, deferredQuery, navigate, setAddress])

  // Navigation can return to the same address before a pending query reaches it.
  const [heard, setHeard] = useState({ key, asked })
  const hasQueryChanged = asked !== heard.asked
  if (key !== heard.key || hasQueryChanged) {
    setHeard({ key, asked })
    // A new address carrying the current query acknowledges our write, not a newer draft.
    if (!hasQueryChanged || asked !== followed) searchFor(asked)
  }

  return search
}
