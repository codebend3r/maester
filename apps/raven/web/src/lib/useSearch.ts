import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

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
  const asked = address.get('q') ?? ''
  const search = useSearch({ initial: asked })
  const { query, searchFor } = search

  useEffect(() => {
    setAddress(
      (current) => {
        const next = new URLSearchParams(current)
        if (query) next.set('q', query)
        else next.delete('q')
        return next
      },
      { replace: true },
    )
  }, [query, setAddress])

  // Only a change of address is news, and one the box wrote already matches its query.
  const [heard, setHeard] = useState(asked)
  if (asked !== heard) {
    setHeard(asked)
    if (asked !== query) searchFor(asked)
  }

  return search
}
