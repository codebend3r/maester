import { SEARCH_DELAY_MS } from '@raven/core'
import { useEffect, useState } from 'react'

type UseSearchProps = { initial?: string }

/**
 * A search box's state: the text as typed, and the `query` it asks for,
 * which follows the text only once typing pauses for `SEARCH_DELAY_MS`, so a
 * search runs once per pause rather than once per keystroke. `searchNow`
 * skips the wait, as Enter does, and `searchFor` sets the box from outside it.
 * `committed` is what those two last asked for outright, for a page that
 * waits for Enter while the box offers suggestions on the pause; an emptied
 * box clears it along with the query.
 */
export const useSearch = ({ initial = '' }: UseSearchProps = {}) => {
  const [text, setText] = useState(initial)
  const [query, setQuery] = useState(initial.trim())
  const [committed, setCommitted] = useState(initial.trim())
  useEffect(() => {
    const next = text.trim()
    // Nothing to wait for while the query already follows the text.
    if (next === query) return
    const timer = setTimeout(() => {
      setQuery(next)
      if (next === '') setCommitted('')
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text, query])
  const commit = (next: string) => {
    setQuery(next)
    setCommitted(next)
  }
  return {
    text,
    setText,
    query,
    committed,
    searchNow: () => commit(text.trim()),
    searchFor: (next: string) => {
      setText(next)
      commit(next.trim())
    },
  }
}

export type Search = ReturnType<typeof useSearch>
