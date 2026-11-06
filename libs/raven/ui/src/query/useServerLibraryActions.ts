import {
  type ApiClient,
  type Library,
  SCAN_KINDS,
  isRefreshingRatings,
  isScanning,
} from '@raven/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { afterRematch, afterRescan } from '@/query/invalidate'
import { queryKeys } from '@/query/queryClient'

type UseLibraryCallProps = {
  library: Library
  call: (id: number) => Promise<Library>
}

/**
 * One call to the server about a library, whose answer is the library as it stands after: it
 * goes into the cache at once, and the listings that hold a scan's progress are read again.
 */
const useLibraryCall = ({ library, call }: UseLibraryCallProps) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => call(library.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.library(library.id), updated)
      return afterRescan(queryClient)
    },
  })
}

const ignore = () => undefined

type UseServerLibraryActionsProps = {
  api: ApiClient
  library: Library
  /** Called once the server has queued the library's intros and credits scan. */
  onMarkersQueued?: () => void
  /** Called with how many albums a merge joined. */
  onAlbumsMerged?: (merged: number) => void
}

/**
 * A library's owner actions on one server: Quick scan, Full scan, Scan intros and credits,
 * Update ratings, Match again and Merge duplicate albums, the long ones each with the Cancel
 * that stops it. A press shows at once; the library's own status keeps the running flags up
 * until the work has ended, as an answer can already be idle for a library with nothing to do.
 */
export const useServerLibraryActions = ({
  api,
  library,
  onMarkersQueued = ignore,
  onAlbumsMerged = ignore,
}: UseServerLibraryActionsProps) => {
  const queryClient = useQueryClient()
  const quickScan = useLibraryCall({ library, call: (id) => api.quickScanLibrary(id) })
  const cancelQuickScan = useLibraryCall({ library, call: (id) => api.cancelQuickScan(id) })
  const fullScan = useLibraryCall({ library, call: (id) => api.scanLibrary(id) })
  const cancelFullScan = useLibraryCall({ library, call: (id) => api.cancelScan(id) })
  const scanMarkers = useLibraryCall({
    library,
    call: async (id) => {
      const updated = await api.scanLibraryMarkers(id)
      onMarkersQueued()
      return updated
    },
  })
  const updateRatings = useLibraryCall({ library, call: (id) => api.updateLibraryRatings(id) })
  const cancelRatings = useLibraryCall({ library, call: (id) => api.cancelLibraryRatings(id) })
  const rematch = useMutation({
    mutationFn: () => api.matchLibrary(library.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.library(library.id), updated)
      return afterRematch({ queryClient, libraryId: library.id })
    },
  })
  const mergeAlbums = useMutation({
    mutationFn: () => api.mergeLibraryAlbums(library.id),
    onSuccess: ({ merged }) => {
      onAlbumsMerged(merged)
      return afterRematch({ queryClient, libraryId: library.id })
    },
  })
  const { scan } = library
  const isScanRunning = isScanning(scan)
  return {
    quickScan,
    cancelQuickScan,
    fullScan,
    cancelFullScan,
    scanMarkers,
    updateRatings,
    cancelRatings,
    rematch,
    mergeAlbums,
    isScanRunning,
    isQuickScanning: quickScan.isPending || (isScanRunning && scan.kind === SCAN_KINDS.quick),
    isFullScanning: fullScan.isPending || (isScanRunning && scan.kind === SCAN_KINDS.full),
    isUpdatingRatings: updateRatings.isPending || isRefreshingRatings(library),
  }
}
