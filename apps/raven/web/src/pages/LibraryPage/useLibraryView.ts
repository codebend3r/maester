import { useQueryClient } from '@tanstack/react-query'
import {
  type Library,
  type LibraryViewChange,
  coherentSettings,
  isLibraryView,
  isMediaGroupBy,
  isMediaSort,
} from '@raven/core'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { librarySettingsEdits } from '@/lib/edits'
import { afterLibraryView } from '@/lib/invalidate'
import { useOptimisticMutation } from '@/lib/optimistic'
import { mutationKeys } from '@/lib/queryClient'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

/** A fresh deal for a random sort; the order holds while the page is open. */
const dealSeed = (): number => Math.floor(Math.random() * 2 ** 31)

/**
 * The view the address carries, `?q=&sort=&view=&group=`, so a refresh or a
 * shared link lands on the same search, order and layout; what the address
 * leaves out comes from the library's own settings.
 */
export const viewFromUrl = (params: URLSearchParams): LibraryViewChange => {
  const sort = params.get('sort')
  const view = params.get('view')
  const group = params.get('group')
  return {
    ...(isMediaSort(sort) ? { sort } : {}),
    ...(isLibraryView(view) ? { view } : {}),
    ...(isMediaGroupBy(group) ? { groupBy: group } : {}),
  }
}

/** The address with `change` written into it. */
export const writeView = ({
  params,
  change,
}: {
  params: URLSearchParams
  change: LibraryViewChange
}): URLSearchParams => {
  const next = new URLSearchParams(params)
  if (change.sort != null) next.set('sort', change.sort)
  if (change.view != null) next.set('view', change.view)
  if (change.groupBy != null) next.set('group', change.groupBy)
  return next
}

/**
 * How a library is being looked at: its saved settings under whatever the
 * address says, and the search. A change of sort, view or grouping shows at
 * once, rides in the address, and saves behind; a failed save puts the
 * library back as it was and says so.
 */
export const useLibraryView = ({ library }: { library: Library }) => {
  const queryClient = useQueryClient()
  const [address, setAddress] = useSearchParams()
  const [search, setSearch] = useState(address.get('q') ?? '')
  const [seed] = useState(dealSeed)
  const query = useDebouncedValue({ value: search.trim(), delayMs: 200 })
  // The address may ask for what the library's type cannot show; that is settled here, once.
  const settings = coherentSettings({ ...library.settings, ...viewFromUrl(address) })

  // The search rides in the address once it settles, replacing rather than
  // stacking history entries as the viewer types.
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

  const save = useOptimisticMutation({
    mutationKey: mutationKeys.libraryView(library.id),
    mutationFn: api.setLibraryView,
    edits: ({ id, change }) => librarySettingsEdits({ libraryId: id, change }),
    settle: () => afterLibraryView({ queryClient, libraryId: library.id }),
  })

  return {
    settings,
    search,
    setSearch,
    /** The search once typing settles. */
    query,
    /** The random sort's deal; 0 for every other sort, so they share a cache entry. */
    seed: settings.sort === 'random' ? seed : 0,
    change: (change: LibraryViewChange) => {
      setAddress(writeView({ params: address, change }), { replace: true })
      save.mutate({ id: library.id, change })
    },
    saveError: save.failure,
  }
}
