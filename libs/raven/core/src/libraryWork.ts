import type { ApiClient } from '@/apiClient'
import { type Library, RATINGS_REFRESH_STATES, SCAN_KINDS, SCAN_STATES } from '@/contract'

/** The long work a library can be running, for each client to put in its own words. */
export const LIBRARY_WORK_KINDS = {
  quickScan: 'quickScan',
  fullScan: 'fullScan',
  ratings: 'ratings',
} as const

export type LibraryWorkKind = (typeof LIBRARY_WORK_KINDS)[keyof typeof LIBRARY_WORK_KINDS]

type ActiveWork = { library: Library; kind: LibraryWorkKind; cancel: () => Promise<Library> }

type ActiveWorkApi = Pick<ApiClient, 'cancelQuickScan' | 'cancelScan' | 'cancelLibraryRatings'>

type WorkOfProps = { api: ActiveWorkApi; library: Library }

/** The scan a library is running, if any, with the call that stops that kind of scan. */
const scanWorkOf = ({ api, library }: WorkOfProps): ActiveWork[] => {
  if (library.scan.state === SCAN_STATES.idle) return []
  if (library.scan.kind === SCAN_KINDS.quick) {
    return [
      {
        library,
        kind: LIBRARY_WORK_KINDS.quickScan,
        cancel: () => api.cancelQuickScan(library.id),
      },
    ]
  }
  return [{ library, kind: LIBRARY_WORK_KINDS.fullScan, cancel: () => api.cancelScan(library.id) }]
}

/** The ratings update a library is running, if any, with the call that stops it. */
const ratingsWorkOf = ({ api, library }: WorkOfProps): ActiveWork[] => {
  if (library.ratingsRefresh.state !== RATINGS_REFRESH_STATES.running) return []
  return [
    {
      library,
      kind: LIBRARY_WORK_KINDS.ratings,
      cancel: () => api.cancelLibraryRatings(library.id),
    },
  ]
}

type ActiveWorkOfProps = { api: ActiveWorkApi; libraries: readonly Library[] }

/** Every scan and ratings update running across `libraries`, each with the call that stops it. */
export const activeWorkOf = ({ api, libraries }: ActiveWorkOfProps): ActiveWork[] =>
  libraries.flatMap((library) => [
    ...scanWorkOf({ api, library }),
    ...ratingsWorkOf({ api, library }),
  ])
