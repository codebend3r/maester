import type { Library } from '@raven/core'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  afterLibraryOrder,
  libraryOrderEdits,
  mutationKeys,
  useOptimisticMutation,
} from '@raven/ui/headless'
import { api } from '@/lib/api'
import { moveId, sameOrder } from '@/lib/libraryOrder'

/** The ids of `libraries`, in the order they list. */
const idsOf = (libraries: readonly Library[]): readonly number[] =>
  libraries.map((library) => library.id)

/**
 * The admin's reordering of the libraries. Starting an edit takes a draft of
 * the order; moves change only the draft; Finish sends it, shown at once and
 * put back if the server refuses. Leaving the page with the draft changed
 * sends it too, so a click on another route loses nothing.
 */
export const useLibraryOrdering = ({ libraries }: { libraries: readonly Library[] }) => {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<readonly number[] | null>(null)
  const save = useOptimisticMutation({
    mutationKey: mutationKeys.libraryOrder,
    mutationFn: (ids: readonly number[]) => api.reorderLibraries({ ids: [...ids] }),
    edits: (ids) => libraryOrderEdits({ ids }),
    settle: () => afterLibraryOrder(queryClient),
  })

  // The unmount cleanup runs once, so it reads what is current through a ref.
  const latest = useRef({ draft, send: save.mutate })
  useEffect(() => {
    latest.current = { ...latest.current, draft, send: save.mutate }
  })
  const before = useRef<readonly number[]>([])

  useEffect(
    () => () => {
      const { draft: pending, send } = latest.current
      if (pending && !sameOrder({ a: pending, b: before.current })) send(pending)
    },
    [],
  )

  const byId = new Map(libraries.map((library) => [library.id, library]))
  const ordered = draft
    ? [
        ...draft.flatMap((id) => byId.get(id) ?? []),
        ...libraries.filter((library) => !draft.includes(library.id)),
      ]
    : libraries

  return {
    isEditing: draft !== null,
    ordered,
    failure: save.failure,
    start: () => {
      before.current = idsOf(libraries)
      setDraft(before.current)
    },
    finish: () => {
      if (draft && !sameOrder({ a: draft, b: before.current })) save.mutate(draft)
      setDraft(null)
    },
    move: ({ id, to }: { id: number; to: number }) =>
      setDraft((current) => (current ? moveId({ ids: current, id, to }) : current)),
  }
}
