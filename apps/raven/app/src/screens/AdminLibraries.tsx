import {
  type ApiClient,
  LIBRARY_KINDS,
  type Library,
  RATINGS_REFRESH_STATES,
  SCAN_KINDS,
  SCAN_STATES,
  isRefreshingRatings,
  isScanning,
  matchTypeFor,
} from '@raven/core'
import { afterRematch, afterRescan, queryKeys } from '@raven/ui/headless'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { SettingsButton, SettingsLine, SettingsSection } from '@/layouts'
import type { AppQueries } from '@/queries/useAppQueries'
import { ADMIN_COPY, LIBRARY_ACTIONS_COPY } from '@/screens/adminCopy'

/** How often the scans are read again while the owner's settings are open, as the web's. */
const SCANS_POLL_MS = 2000

/** What a merge says it did: none found, or how many albums it joined. */
const mergedLineOf = (merged: number): string => {
  if (merged === 0) return LIBRARY_ACTIONS_COPY.noAlbumsMerged
  return LIBRARY_ACTIONS_COPY.albumsMerged(merged)
}

type ActiveWork = { library: Library; label: string; cancel: () => Promise<Library> }

type ActiveWorkOfProps = { api: ApiClient; libraries: readonly Library[] }

/** Every scan and ratings update running, each with the call that stops it. */
const activeWorkOf = ({ api, libraries }: ActiveWorkOfProps): ActiveWork[] =>
  libraries.flatMap((library) => {
    const isQuick = library.scan.kind === SCAN_KINDS.quick
    const label = isQuick ? LIBRARY_ACTIONS_COPY.quickScan : LIBRARY_ACTIONS_COPY.fullScan
    const cancel = isQuick
      ? () => api.cancelQuickScan(library.id)
      : () => api.cancelScan(library.id)
    const scan = library.scan.state === SCAN_STATES.idle ? [] : [{ library, label, cancel }]
    const ratings =
      library.ratingsRefresh.state === RATINGS_REFRESH_STATES.running
        ? [
            {
              library,
              label: ADMIN_COPY.ratingsWork,
              cancel: () => api.cancelLibraryRatings(library.id),
            },
          ]
        : []
    return [...scan, ...ratings]
  })

type UseLibraryCallProps = {
  library: Library
  call: (id: number) => Promise<Library>
}

/** One call about a library whose answer is the library after it, put in the cache at once. */
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

type LongActionProps = {
  label: string
  library: Library
  isRunning: boolean
  isDisabled: boolean
  isCancelling: boolean
  onStart: () => void
  onCancel: () => void
}

/** A long action's button, which becomes its Cancel while it runs, in the same place. */
const LongAction = ({
  label,
  library,
  isRunning,
  isDisabled,
  isCancelling,
  onStart,
  onCancel,
}: LongActionProps) => {
  const text = isRunning ? LIBRARY_ACTIONS_COPY.cancel(label) : label
  return (
    <SettingsButton
      isDisabled={isRunning ? isCancelling : isDisabled}
      name={LIBRARY_ACTIONS_COPY.named({ label: text, library: library.name })}
      onPress={isRunning ? onCancel : onStart}
      text={text}
    />
  )
}

type LibraryAdminProps = { api: ApiClient; library: Library }

/**
 * One library's work, as the web's library actions: Quick scan, Full scan, Scan intros and
 * credits, Merge duplicate albums, Update ratings and Match again, each long one with its Cancel.
 */
const LibraryAdmin = ({ api, library }: LibraryAdminProps) => {
  const queryClient = useQueryClient()
  const quickScan = useLibraryCall({ library, call: (id) => api.quickScanLibrary(id) })
  const cancelQuickScan = useLibraryCall({ library, call: (id) => api.cancelQuickScan(id) })
  const fullScan = useLibraryCall({ library, call: (id) => api.scanLibrary(id) })
  const cancelFullScan = useLibraryCall({ library, call: (id) => api.cancelScan(id) })
  const scanMarkers = useLibraryCall({ library, call: (id) => api.scanLibraryMarkers(id) })
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
    onSuccess: () => afterRematch({ queryClient, libraryId: library.id }),
  })
  const matchType = matchTypeFor(library.settings.kind)
  const isScanRunning = isScanning(library.scan)
  const isQuickScanning =
    quickScan.isPending || (isScanRunning && library.scan.kind === SCAN_KINDS.quick)
  const isFullScanning =
    fullScan.isPending || (isScanRunning && library.scan.kind === SCAN_KINDS.full)
  const failures = [
    { label: LIBRARY_ACTIONS_COPY.quickScan, error: quickScan.error ?? cancelQuickScan.error },
    { label: LIBRARY_ACTIONS_COPY.fullScan, error: fullScan.error ?? cancelFullScan.error },
    { label: LIBRARY_ACTIONS_COPY.scanMarkers, error: scanMarkers.error },
    { label: LIBRARY_ACTIONS_COPY.mergeAlbums, error: mergeAlbums.error },
    {
      label: LIBRARY_ACTIONS_COPY.updateRatings,
      error: updateRatings.error ?? cancelRatings.error,
    },
    { label: LIBRARY_ACTIONS_COPY.matchAgain, error: rematch.error },
  ]
  return (
    <SettingsSection note={null} title={library.name}>
      <LongAction
        isCancelling={cancelQuickScan.isPending}
        isDisabled={isScanRunning || quickScan.isPending}
        isRunning={isQuickScanning}
        label={LIBRARY_ACTIONS_COPY.quickScan}
        library={library}
        onCancel={() => cancelQuickScan.mutate()}
        onStart={() => quickScan.mutate()}
      />
      <LongAction
        isCancelling={cancelFullScan.isPending}
        isDisabled={isScanRunning || fullScan.isPending}
        isRunning={isFullScanning}
        label={LIBRARY_ACTIONS_COPY.fullScan}
        library={library}
        onCancel={() => cancelFullScan.mutate()}
        onStart={() => fullScan.mutate()}
      />
      {matchType !== null && (
        <SettingsButton
          isDisabled={scanMarkers.isPending}
          name={LIBRARY_ACTIONS_COPY.named({
            label: LIBRARY_ACTIONS_COPY.scanMarkers,
            library: library.name,
          })}
          onPress={() => scanMarkers.mutate()}
          text={LIBRARY_ACTIONS_COPY.scanMarkers}
        />
      )}
      {scanMarkers.isSuccess && <SettingsLine text={LIBRARY_ACTIONS_COPY.markersQueued} />}
      {library.settings.kind === LIBRARY_KINDS.music && (
        <SettingsButton
          isDisabled={mergeAlbums.isPending}
          name={LIBRARY_ACTIONS_COPY.named({
            label: LIBRARY_ACTIONS_COPY.mergeAlbums,
            library: library.name,
          })}
          onPress={() => mergeAlbums.mutate()}
          text={LIBRARY_ACTIONS_COPY.mergeAlbums}
        />
      )}
      {mergeAlbums.data !== undefined && (
        <SettingsLine text={mergedLineOf(mergeAlbums.data.merged)} />
      )}
      <LongAction
        isCancelling={cancelRatings.isPending}
        isDisabled={updateRatings.isPending}
        isRunning={updateRatings.isPending || isRefreshingRatings(library)}
        label={LIBRARY_ACTIONS_COPY.updateRatings}
        library={library}
        onCancel={() => cancelRatings.mutate()}
        onStart={() => updateRatings.mutate()}
      />
      {matchType !== null && (
        <SettingsButton
          isDisabled={library.unmatchedCount === 0 || rematch.isPending}
          name={LIBRARY_ACTIONS_COPY.named({
            label: LIBRARY_ACTIONS_COPY.matchAgain,
            library: library.name,
          })}
          onPress={() => rematch.mutate()}
          text={LIBRARY_ACTIONS_COPY.matchAgain}
        />
      )}
      {failures.map(
        ({ label, error }) =>
          error !== null && (
            <SettingsLine
              key={label}
              isAlert
              text={LIBRARY_ACTIONS_COPY.couldNot({
                verb: label.toLowerCase(),
                message: error.message,
              })}
            />
          ),
      )}
    </SettingsSection>
  )
}

type AdminLibrariesProps = { session: AppQueries }

/**
 * Admin's Library scans, as the web's: what runs across every library and the one press that
 * stops it all; then each library's own scans, read again every two seconds while open.
 */
export const AdminLibraries = ({ session: { api, queries } }: AdminLibrariesProps) => {
  const queryClient = useQueryClient()
  const state = useQuery({ ...queries.librariesQuery, refetchInterval: SCANS_POLL_MS })
  const libraries = state.data ?? []
  const running = activeWorkOf({ api, libraries })
  const cancel = useMutation({
    mutationFn: async () => {
      await Promise.all(activeWorkOf({ api, libraries }).map((work) => work.cancel()))
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queries.librariesQuery.queryKey, exact: true }),
  })
  const error = state.error ?? cancel.error
  return (
    <>
      <SettingsSection note={ADMIN_COPY.scansHint} title={ADMIN_COPY.scans}>
        {state.data !== undefined && running.length === 0 && (
          <SettingsLine text={ADMIN_COPY.noScans} />
        )}
        {running.map(({ library, label }) => (
          <SettingsLine
            key={`${library.id}-${label}`}
            text={ADMIN_COPY.running({ library: library.name, work: label })}
          />
        ))}
        {state.data !== undefined && (
          <SettingsButton
            isDisabled={cancel.isPending || running.length === 0}
            onPress={() => cancel.mutate()}
            text={ADMIN_COPY.stopScans}
          />
        )}
        {error !== null && <SettingsLine isAlert text={error.message} />}
      </SettingsSection>
      {libraries.map((library) => (
        <LibraryAdmin key={library.id} api={api} library={library} />
      ))}
    </>
  )
}
