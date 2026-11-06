import { useQuery } from '@tanstack/react-query'
import { type Library, LIBRARY_KINDS, METADATA_SERVICE_STATES, matchTypeFor } from '@raven/core'
import { type ReactNode, useState } from 'react'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { Button, ButtonLink, type IconName, useToasts } from '@raven/ui'
import { useRatingsRefreshDone } from '@/components/LibraryActions/useRatingsRefreshDone'
import { LibraryDialog } from '@/components/LibraryDialog/LibraryDialog'
import styles from '@/components/LibraryActions/LibraryActions.module.scss'
import { LIBRARY_ACTIONS_COPY } from '@/components/LibraryActions/copy'
import { Spinner } from '@/components/Spinner/Spinner'
import { api } from '@/lib/api'
import { useServerLibraryActions } from '@raven/ui/headless'
import { metadataHealthQuery } from '@/lib/queries'
import { COMMON_COPY } from '@/lib/copy'

/**
 * Quick scan, Full scan, Update ratings and Match again for a library, each
 * of the first three with the Cancel that stops it. The caller holds them, as
 * their errors show on its page below the tabs and in its row below the
 * scan's status. A queued markers scan and a merge each say so in a toast.
 */
export const useLibraryActions = (library: Library) => {
  const showToast = useToasts((state) => state.show)
  const actions = useServerLibraryActions({
    api,
    library,
    onMarkersQueued: () => showToast(LIBRARY_ACTIONS_COPY.markersQueued),
    onAlbumsMerged: (merged) => showToast(LIBRARY_ACTIONS_COPY.albumsMerged(merged)),
  })
  useRatingsRefreshDone(library)
  return actions
}

type LibraryActionErrorsProps = {
  actions: ReturnType<typeof useLibraryActions>
  className: string
}

/**
 * Why a scan, Update ratings, a cancel or Match again was refused, one line
 * each, for the caller to place where its errors show.
 */
export const LibraryActionErrors = ({
  actions: {
    quickScan,
    cancelQuickScan,
    fullScan,
    cancelFullScan,
    scanMarkers,
    updateRatings,
    cancelRatings,
    rematch,
    mergeAlbums,
  },
  className,
}: LibraryActionErrorsProps) =>
  [
    { verb: LIBRARY_ACTIONS_COPY.verbs.quickScan, failure: quickScan.error },
    { verb: LIBRARY_ACTIONS_COPY.verbs.cancelQuickScan, failure: cancelQuickScan.error },
    { verb: LIBRARY_ACTIONS_COPY.verbs.fullScan, failure: fullScan.error },
    { verb: LIBRARY_ACTIONS_COPY.verbs.cancelFullScan, failure: cancelFullScan.error },
    { verb: LIBRARY_ACTIONS_COPY.verbs.updateRatings, failure: updateRatings.error },
    { verb: LIBRARY_ACTIONS_COPY.verbs.cancelRatings, failure: cancelRatings.error },
    { verb: LIBRARY_ACTIONS_COPY.verbs.rematch, failure: rematch.error },
    { verb: LIBRARY_ACTIONS_COPY.verbs.scanMarkers, failure: scanMarkers.error },
    { verb: LIBRARY_ACTIONS_COPY.verbs.mergeAlbums, failure: mergeAlbums.error },
  ].map(
    ({ verb, failure }) =>
      failure && (
        <p key={verb} className={className} role="alert">
          {LIBRARY_ACTIONS_COPY.couldNot({ verb, message: failure.message })}
        </p>
      ),
  )

type LongActionProps = {
  label: string
  /** What the button wears until it runs, when the spinner takes its place. */
  icon: IconName
  whose: ReactNode
  title: string
  cancelTitle: string
  isRunning: boolean
  isDisabled: boolean
  isCancelling: boolean
  onStart: () => void
  onCancel: () => void
}

/**
 * One of a library's long actions: a button that starts it, and, while it
 * runs, shows a spinner and becomes the button that cancels it, in the same
 * place, so there is never a second button to look for. Its name says which
 * it is, and names its library to a screen reader.
 */
const LongAction = ({
  label,
  icon,
  whose,
  title,
  cancelTitle,
  isRunning,
  isDisabled,
  isCancelling,
  onStart,
  onCancel,
}: LongActionProps) => (
  <Button
    icon={isRunning ? undefined : icon}
    disabled={isRunning ? isCancelling : isDisabled}
    title={isRunning ? cancelTitle : title}
    onClick={isRunning ? onCancel : onStart}
  >
    {isRunning && <Spinner />}
    {isRunning ? LIBRARY_ACTIONS_COPY.cancel(label) : label}
    {whose}
  </Button>
)

type MatchAgainTitleProps = {
  matchType: string
  canMatch: boolean
  unmatched: number
}

/** What Match again says on hover: what it does, or why it cannot now. */
const matchAgainTitle = ({ matchType, canMatch, unmatched }: MatchAgainTitleProps): string => {
  if (!canMatch) return LIBRARY_ACTIONS_COPY.tmdbDown
  if (unmatched === 0) return LIBRARY_ACTIONS_COPY.nothingToMatch(matchType)
  return LIBRARY_ACTIONS_COPY.matchAgainTitle(matchType)
}

type LibraryActionsProps = {
  library: Library
  isShut: boolean
  /** What goes first in the row of buttons: the Libraries page's Pin. */
  lead?: ReactNode
  /** What goes last in it: the library page's Lock. */
  trail?: ReactNode
  actions: ReturnType<typeof useLibraryActions>
}

/**
 * A library's history, and Quick scan, Full scan, Update ratings, Match again and Edit with the
 * admin lock off, in its page's header and on its card on the Libraries page,
 * as words alone. Each names its library to a screen reader, as the list has
 * the same buttons on every card.
 */
export const LibraryActions = ({
  library,
  isShut,
  lead,
  trail,
  actions: {
    quickScan,
    cancelQuickScan,
    fullScan,
    cancelFullScan,
    updateRatings,
    cancelRatings,
    rematch,
    scanMarkers,
    mergeAlbums,
    isScanRunning,
    isQuickScanning,
    isFullScanning,
    isUpdatingRatings,
  },
}: LibraryActionsProps) => {
  const [isEditing, setEditing] = useState(false)
  const matchType = matchTypeFor(library.settings.kind)
  // Files only leave pending while TMDB answers, so Match again waits on it.
  const metadata = useQuery({ ...metadataHealthQuery, enabled: matchType != null })
  const canMatch = metadata.data?.tmdb === METADATA_SERVICE_STATES.ok
  const whose = <span className="visually-hidden"> {library.name}</span>
  const canMergeAlbums = library.settings.kind === LIBRARY_KINDS.music

  return (
    <>
      <div className={styles.row}>
        {lead}
        <ButtonLink
          icon="history"
          to={`/libraries/${library.id}/history`}
          title={LIBRARY_ACTIONS_COPY.historyTitle}
        >
          {COMMON_COPY.history}
          {whose}
        </ButtonLink>
        <AdminOnly>
          {matchType && (
            <Button
              icon="search"
              disabled={!canMatch || library.unmatchedCount === 0 || rematch.isPending}
              title={matchAgainTitle({ matchType, canMatch, unmatched: library.unmatchedCount })}
              onClick={() => rematch.mutate()}
            >
              {LIBRARY_ACTIONS_COPY.matchAgain}
              {whose}
            </Button>
          )}
          <Button
            icon="edit"
            title={LIBRARY_ACTIONS_COPY.editTitle}
            disabled={isShut}
            onClick={() => setEditing(true)}
          >
            {LIBRARY_ACTIONS_COPY.edit}
            {whose}
          </Button>
          {isEditing && <LibraryDialog library={library} onClose={() => setEditing(false)} />}
        </AdminOnly>
        {trail}
      </div>
      <AdminOnly>
        <div className={styles.row}>
          <LongAction
            label={LIBRARY_ACTIONS_COPY.quickScan}
            icon="forward"
            whose={whose}
            title={LIBRARY_ACTIONS_COPY.quickScanTitle}
            cancelTitle={LIBRARY_ACTIONS_COPY.cancelQuickScanTitle}
            isRunning={isQuickScanning}
            isDisabled={isScanRunning || quickScan.isPending}
            isCancelling={cancelQuickScan.isPending}
            onStart={() => quickScan.mutate()}
            onCancel={() => cancelQuickScan.mutate()}
          />
          <LongAction
            label={LIBRARY_ACTIONS_COPY.fullScan}
            icon="rescan"
            whose={whose}
            title={LIBRARY_ACTIONS_COPY.fullScanTitle}
            cancelTitle={LIBRARY_ACTIONS_COPY.cancelFullScanTitle}
            isRunning={isFullScanning}
            isDisabled={isScanRunning || fullScan.isPending}
            isCancelling={cancelFullScan.isPending}
            onStart={() => fullScan.mutate()}
            onCancel={() => cancelFullScan.mutate()}
          />
          {matchType && (
            <Button
              icon="skipNext"
              disabled={scanMarkers.isPending}
              onClick={() => scanMarkers.mutate()}
            >
              {LIBRARY_ACTIONS_COPY.scanMarkers}
              {whose}
            </Button>
          )}
          {canMergeAlbums && (
            <Button
              icon="shuffle"
              disabled={mergeAlbums.isPending}
              title={LIBRARY_ACTIONS_COPY.mergeAlbumsTitle}
              onClick={() => mergeAlbums.mutate()}
            >
              {mergeAlbums.isPending && <Spinner />}
              {LIBRARY_ACTIONS_COPY.mergeAlbums}
              {whose}
            </Button>
          )}
          <LongAction
            label={LIBRARY_ACTIONS_COPY.updateRatings}
            icon="gauge"
            whose={whose}
            title={LIBRARY_ACTIONS_COPY.updateRatingsTitle}
            cancelTitle={LIBRARY_ACTIONS_COPY.cancelRatingsTitle}
            isRunning={isUpdatingRatings}
            isDisabled={updateRatings.isPending}
            isCancelling={cancelRatings.isPending}
            onStart={() => updateRatings.mutate()}
            onCancel={() => cancelRatings.mutate()}
          />
        </div>
      </AdminOnly>
    </>
  )
}
