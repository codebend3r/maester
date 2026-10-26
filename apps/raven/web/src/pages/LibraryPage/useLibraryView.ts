import { useQueryClient } from '@tanstack/react-query'
import {
  type Library,
  type LibraryViewChange,
  MEDIA_SORTS,
  coherentSettings,
  isLibraryView,
  isMediaGroupBy,
  isMediaSort,
} from '@raven/core'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import {
  afterLibraryView,
  librarySettingsEdits,
  mutationKeys,
  useOptimisticMutation,
} from '@raven/ui/headless'
import { useAddressSearch } from '@/lib/useSearch'

/** A fresh deal for a random sort; the order holds while the page is open. */
const dealSeed = (): number => Math.floor(Math.random() * 2 ** 31)

/**
 * The view the address carries, `?q=&sort=&view=&group=`, so a refresh or a
 * shared link lands on the same search, order and layout; what the address
 * leaves out comes from the library's own settings.
 */
const viewFromUrl = (params: URLSearchParams): LibraryViewChange => {
  const sort = params.get('sort')
  const view = params.get('view')
  const group = params.get('group')
  return {
    ...(isMediaSort(sort) ? { sort } : {}),
    ...(isLibraryView(view) ? { view } : {}),
    ...(isMediaGroupBy(group) ? { groupBy: group } : {}),
  }
}

type WriteViewProps = {
  params: URLSearchParams
  change: LibraryViewChange
}

/** The address with `change` written into it. */
const writeView = ({ params, change }: WriteViewProps): URLSearchParams => {
  const next = new URLSearchParams(params)
  if (change.sort != null) next.set('sort', change.sort)
  if (change.view != null) next.set('view', change.view)
  if (change.groupBy != null) next.set('group', change.groupBy)
  return next
}

type UseLibraryViewProps = { library: Library }

/**
 * How a library is being looked at: its saved settings under whatever the
 * address says, and the search. A change of sort, view or grouping rides in
 * the address and saves behind; a failed save puts the library back as it was
 * and says so. Laying a big listing out takes a while, so `shown` takes the
 * change at once, for the controls that name it, and `settings` follows once
 * the address has it, for the listing.
 */
export const useLibraryView = ({ library }: UseLibraryViewProps) => {
  const queryClient = useQueryClient()
  const [address, setAddress] = useSearchParams()
  const search = useAddressSearch()
  const [seed] = useState(dealSeed)
  // What was asked for, until the address it was asked against gives way to one that carries it.
  const [request, setRequest] = useState<{
    change: LibraryViewChange
    against: URLSearchParams
  } | null>(null)
  const asked = request?.against === address ? request.change : null
  // The address may ask for what the library's type cannot show; that is settled here, once.
  const settings = useMemo(
    () => coherentSettings({ ...library.settings, ...viewFromUrl(address) }),
    [library.settings, address],
  )
  const shown = useMemo(
    () => coherentSettings({ ...library.settings, ...viewFromUrl(address), ...asked }),
    [library.settings, address, asked],
  )

  const save = useOptimisticMutation({
    mutationKey: mutationKeys.libraryView(library.id),
    mutationFn: api.setLibraryView,
    edits: ({ id, change }) => librarySettingsEdits({ libraryId: id, change }),
    settle: () => afterLibraryView({ queryClient, libraryId: library.id }),
  })

  return {
    settings,
    shown,
    search,
    /** The search once typing settles. */
    query: search.query,
    /** The random sort's deal; 0 for every other sort, so they share a cache entry. */
    seed: settings.sort === MEDIA_SORTS.random ? seed : 0,
    change: (change: LibraryViewChange) => {
      setRequest({ change: { ...asked, ...change }, against: address })
      setAddress(writeView({ params: address, change }), { replace: true })
      save.mutate({ id: library.id, change })
    },
    saveError: save.failure,
  }
}
