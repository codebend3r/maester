import { SEARCH_DELAY_MS } from '@raven/core'
import { useEffect, useState } from 'react'

/**
 * A search box's state: the text as typed, and the `query` it asks for,
 * which follows the text only once typing pauses for `SEARCH_DELAY_MS`, so a
 * search runs once per pause rather than once per keystroke. `searchNow`
 * skips the wait, as Enter does, and `searchFor` sets the box from outside it.
 */
export const useSearch = ({ initial = '' }: { initial?: string } = {}) => {
  const [text, setText] = useState(initial)
  const [query, setQuery] = useState(initial.trim())
  useEffect(() => {
    const next = text.trim()
    // Nothing to wait for while the query already follows the text.
    if (next === query) return
    const timer = setTimeout(() => setQuery(next), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text, query])
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
