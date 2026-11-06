import {
  type ApiClient,
  LIBRARY_KINDS,
  LIBRARY_WORK_KINDS,
  type Library,
  type LibraryWorkKind,
  matchTypeFor,
} from '@raven/core'
import { useServerActiveWork, useServerLibraryActions } from '@raven/ui/headless'

import { SettingsButton, SettingsLine, SettingsSection } from '@/layouts'
import type { AppQueries } from '@/queries/useAppQueries'
import { ADMIN_COPY, LIBRARY_ACTIONS_COPY } from '@/screens/adminCopy'

/** What a merge says it did: none found, or how many albums it joined. */
const mergedLineOf = (merged: number): string => {
  if (merged === 0) return LIBRARY_ACTIONS_COPY.noAlbumsMerged
  return LIBRARY_ACTIONS_COPY.albumsMerged(merged)
}

const WORK_LABELS = {
  [LIBRARY_WORK_KINDS.quickScan]: LIBRARY_ACTIONS_COPY.quickScan,
  [LIBRARY_WORK_KINDS.fullScan]: LIBRARY_ACTIONS_COPY.fullScan,
  [LIBRARY_WORK_KINDS.ratings]: ADMIN_COPY.ratingsWork,
} as const satisfies Record<LibraryWorkKind, string>

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
  const {
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
    isQuickScanning,
    isFullScanning,
    isUpdatingRatings,
  } = useServerLibraryActions({ api, library })
  const matchType = matchTypeFor(library.settings.kind)
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
        isRunning={isUpdatingRatings}
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
  const { state, running, cancel, error } = useServerActiveWork({
    api,
    librariesQuery: queries.librariesQuery,
  })
  return (
    <>
      <SettingsSection note={ADMIN_COPY.scansHint} title={ADMIN_COPY.scans}>
        {state.data !== undefined && running.length === 0 && (
          <SettingsLine text={ADMIN_COPY.noScans} />
        )}
        {running.map(({ library, kind }) => (
          <SettingsLine
            key={`${library.id}-${kind}`}
            text={ADMIN_COPY.running({ library: library.name, work: WORK_LABELS[kind] })}
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
      {(state.data ?? []).map((library) => (
        <LibraryAdmin key={library.id} api={api} library={library} />
      ))}
    </>
  )
}
