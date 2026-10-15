import { useDeferredValue, useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

/** How long a search box waits after the last keystroke before it searches. */
export const SEARCH_DELAY_MS = 200

/**
 * A search box's state: the text as typed, and the `query` it asks for,
 * which follows the text only once typing pauses, so a search runs once per
 * pause rather than once per keystroke. `searchNow` skips the wait, as
 * Enter does, and `searchFor` sets the box from outside it.
 */
export const useSearch = ({ initial = '' }: { initial?: string } = {}) => {
  const [text, setText] = useState(initial)
  const [query, setQuery] = useState(initial.trim())
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [text])
  return {
    text,
    setText,
    query,
    searchNow: () => setQuery(text.trim()),
    searchFor: (next: string) => {
      setText(next)
      setQuery(next.trim())
    },
  }
}

export type Search = ReturnType<typeof useSearch>

/**
 * A search that rides in the address as `?q=`, so a refresh, a shared link
 * or Back lands on it again. The query is written once it settles,
 * replacing the entry rather than stacking one per pause, and an address
 * the box did not write, as the side menu's link back to the page, puts its
 * search in the box.
 */
export const useAddressSearch = (): Search => {
  const [address, setAddress] = useSearchParams()
  const { key } = useLocation()
  const asked = address.get('q') ?? ''
  const search = useSearch({ initial: asked })
  const { query, searchFor } = search
  // Let a queued navigation commit before a local query can replace its address.
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    if (deferredQuery !== query || deferredQuery === asked) return
    setAddress(
      (current) => {
        const next = new URLSearchParams(current)
        if (deferredQuery) next.set('q', deferredQuery)
        else next.delete('q')
        return next
      },
      { replace: true },
    )
  }, [asked, query, deferredQuery, setAddress])

  // Navigation can return to the same address before a pending query reaches it.
  const [heard, setHeard] = useState({ key, asked })
  const hasQueryChanged = asked !== heard.asked
  if (key !== heard.key || hasQueryChanged) {
    setHeard({ key, asked })
    // A new address carrying the current query acknowledges our write, not a newer draft.
    if (!hasQueryChanged || asked !== query) searchFor(asked)
  }

  return search
}
