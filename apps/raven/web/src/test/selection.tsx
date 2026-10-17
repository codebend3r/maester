import { useEffect } from 'react'
import { useSelectionScope } from '@/components/SelectionScope/SelectionScope'
import type { SelectionScopeValue } from '@/stores/selectionScope'

/** The scope a `Peek` inside it found, for a test to drive select mode by hand. */
export const peeked: { scope: SelectionScopeValue | null } = { scope: null }

/** Renders nothing; leaves the scope it sits in at `peeked.scope`. */
export const Peek = () => {
  const scope = useSelectionScope()
  useEffect(() => {
    peeked.scope = scope
    return () => {
      peeked.scope = null
    }
  }, [scope])
  return null
}
