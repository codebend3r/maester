import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type Library,
  METADATA_SERVICE_STATES,
  SCAN_KINDS,
  isRefreshingRatings,
  isScanning,
  matchTypeFor,
} from '@raven/core'
import { type ReactNode, useState } from 'react'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { Button, ButtonLink, type IconName } from '@raven/ui'
import { useRatingsRefreshDone } from '@/components/LibraryActions/useRatingsRefreshDone'
import { LibraryDialog } from '@/components/LibraryDialog/LibraryDialog'
import styles from '@/components/LibraryActions/LibraryActions.module.scss'
import { Spinner } from '@/components/Spinner/Spinner'
import { api } from '@/lib/api'
import { afterRematch, afterRescan, queryKeys, useUnlockPrompt } from '@raven/ui/headless'
import { metadataHealthQuery } from '@/lib/queries'

type UseLibraryCallProps = {
  library: Library
  call: (id: number) => Promise<Library>
}

/**
 * One call to the server about a library, whose answer is the library as it
 * stands after: it goes into the cache at once, and the listings that hold
 * a scan's progress are read again.
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

/**
 * Quick scan, Full scan, Update ratings and Match again for a library, each
 * of the first three with the Cancel that stops it. The caller holds them, as
 * their errors show on its page below the tabs and in its row below the
 * scan's status. Their progress comes from the library, not from these: an
 * answer can already be idle, for a library with nothing to ask the sources
 * about.
 */
export const useLibraryActions = (library: Library) => {
  const queryClient = useQueryClient()
  const quickScan = useLibraryCall({ library, call: (id) => api.quickScanLibrary(id) })
  const cancelQuickScan = useLibraryCall({ library, call: (id) => api.cancelQuickScan(id) })
  const fullScan = useLibraryCall({ library, call: (id) => api.scanLibrary(id) })
  const cancelFullScan = useLibraryCall({ library, call: (id) => api.cancelScan(id) })
  const updateRatings = useLibraryCall({ library, call: (id) => api.updateLibraryRatings(id) })
  const cancelRatings = useLibraryCall({ library, call: (id) => api.cancelLibraryRatings(id) })
  useRatingsRefreshDone(library)

  const rematch = useMutation({
    mutationFn: () => api.matchLibrary(library.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.library(library.id), updated)
      return afterRematch({ queryClient, libraryId: library.id })
    },
  })

  return {
    quickScan,
    cancelQuickScan,
    fullScan,
    cancelFullScan,
    updateRatings,
    cancelRatings,
    rematch,
  }
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
    updateRatings,
    cancelRatings,
    rematch,
  },
  className,
}: LibraryActionErrorsProps) =>
  [
    { verb: 'quick scan', failure: quickScan.error },
    { verb: 'cancel the quick scan', failure: cancelQuickScan.error },
    { verb: 'run a full scan', failure: fullScan.error },
    { verb: 'cancel the full scan', failure: cancelFullScan.error },
    { verb: 'update ratings', failure: updateRatings.error },
    { verb: 'cancel the ratings update', failure: cancelRatings.error },
    { verb: 'match again', failure: rematch.error },
  ].map(
    ({ verb, failure }) =>
      failure && (
        <p key={verb} className={className} role="alert">
          Could not {verb}: {failure.message}
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
    {isRunning ? `Cancel ${label.toLowerCase()}` : label}
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
  if (!canMatch) return 'TMDB is not answering, so files cannot be matched right now'
  if (unmatched === 0)
    return `Every file in this library has its ${matchType}, so there is nothing to match again`
  return `Search TMDB again for the files no ${matchType} was found for`
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
  },
}: LibraryActionsProps) => {
  const [isEditing, setEditing] = useState(false)
  const matchType = matchTypeFor(library.settings.kind)
  // Files only leave pending while TMDB answers, so Match again waits on it.
  const metadata = useQuery({ ...metadataHealthQuery, enabled: matchType != null })
  const canMatch = metadata.data?.tmdb === METADATA_SERVICE_STATES.ok
  const whose = <span className="visually-hidden"> {library.name}</span>
  // A press shows at once; the library's own status keeps it up until the work has ended.
  const { scan } = library
  const isScanRunning = isScanning(scan)
  const isQuickScanning = quickScan.isPending || (isScanRunning && scan.kind === SCAN_KINDS.quick)
  const isFullScanning = fullScan.isPending || (isScanRunning && scan.kind === SCAN_KINDS.full)
  const isUpdatingRatings = updateRatings.isPending || isRefreshingRatings(library)

  // A locked library's folders stay on the server until the PIN is entered,
  // so Edit asks for it rather than open with none.
  const edit = () => {
    if (isShut) return useUnlockPrompt.getState().ask()
    setEditing(true)
  }

  return (
    <>
      <div className={styles.row}>
        {lead}
        <ButtonLink
          icon="history"
          to={`/libraries/${library.id}/history`}
          title="See what has been played in this library, the most recent first"
        >
          History{whose}
        </ButtonLink>
        <AdminOnly>
          {matchType && (
            <Button
              icon="search"
              disabled={!canMatch || library.unmatchedCount === 0 || rematch.isPending}
              title={matchAgainTitle({ matchType, canMatch, unmatched: library.unmatchedCount })}
              onClick={() => rematch.mutate()}
            >
              Match again{whose}
            </Button>
          )}
          <Button
            icon="edit"
            title="Change this library's name, folders and settings"
            onClick={edit}
          >
            Edit{whose}
          </Button>
          {isEditing && <LibraryDialog library={library} onClose={() => setEditing(false)} />}
        </AdminOnly>
        {trail}
      </div>
      <AdminOnly>
        <div className={styles.row}>
          <LongAction
            label="Quick scan"
            icon="forward"
            whose={whose}
            title="Look only for videos added since the last scan and add them, then fetch their ratings once they are matched"
            cancelTitle="Stop the quick scan, and the ratings that would follow it"
            isRunning={isQuickScanning}
            isDisabled={isScanRunning || quickScan.isPending}
            isCancelling={cancelQuickScan.isPending}
            onStart={() => quickScan.mutate()}
            onCancel={() => cancelQuickScan.mutate()}
          />
          <LongAction
            label="Full scan"
            icon="rescan"
            whose={whose}
            title="Read every file in the library again, picking up new, renamed, moved and replaced videos"
            cancelTitle="Stop the full scan at its next step; the library keeps what was indexed"
            isRunning={isFullScanning}
            isDisabled={isScanRunning || fullScan.isPending}
            isCancelling={cancelFullScan.isPending}
            onStart={() => fullScan.mutate()}
            onCancel={() => cancelFullScan.mutate()}
          />
          <LongAction
            label="Update ratings"
            icon="gauge"
            whose={whose}
            title="Find the movies and shows with no rating and fetch their ratings; needs a ratings source (TMDB, OMDb or MDBList)"
            cancelTitle="Stop updating ratings: the titles still waiting are not asked for, and the ratings already fetched stay"
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
