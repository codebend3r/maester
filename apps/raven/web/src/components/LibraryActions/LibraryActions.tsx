import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type Library, METADATA_SERVICE_STATES, isScanning, matchTypeFor } from '@raven/core'
import { useState } from 'react'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { Button, ButtonLink } from '@raven/ui'
import { useRatingsRefreshDone } from '@/components/LibraryActions/useRatingsRefreshDone'
import { LibraryDialog } from '@/components/LibraryDialog/LibraryDialog'
import { api } from '@/lib/api'
import { afterRematch, afterRescan } from '@/lib/invalidate'
import { metadataHealthQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/queryClient'
import { useUnlockPrompt } from '@/stores/unlockPrompt'

/**
 * Refresh, Rescan and Match again for a library. The caller holds them, as
 * their errors show on its page below the tabs and in its row below the
 * scan's status.
 */
export const useLibraryActions = (library: Library) => {
  const queryClient = useQueryClient()

  const rescan = useMutation({
    mutationFn: () => api.scanLibrary(library.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.library(library.id), updated)
      return afterRescan(queryClient)
    },
  })

  // Its progress comes from the library, not from this: the answer can
  // already be idle, for a library with nothing to ask the sources about.
  const refresh = useMutation({
    mutationFn: () => api.refreshLibrary(library.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.library(library.id), updated)
      return afterRescan(queryClient)
    },
  })
  useRatingsRefreshDone(library)

  const rematch = useMutation({
    mutationFn: () => api.matchLibrary(library.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.library(library.id), updated)
      return afterRematch({ queryClient, libraryId: library.id })
    },
  })

  return { refresh, rescan, rematch }
}

/**
 * Why Refresh, Rescan or Match again was refused, one line each, for the
 * caller to place where its errors show.
 */
export const LibraryActionErrors = ({
  actions: { refresh, rescan, rematch },
  className,
}: {
  actions: ReturnType<typeof useLibraryActions>
  className: string
}) =>
  [
    { verb: 'refresh', failure: refresh.error },
    { verb: 'rescan', failure: rescan.error },
    { verb: 'match again', failure: rematch.error },
  ].map(
    ({ verb, failure }) =>
      failure && (
        <p key={verb} className={className} role="alert">
          Could not {verb}: {failure.message}
        </p>
      ),
  )

/**
 * A library's history, and Refresh, Rescan, Match again and Edit with the
 * admin lock off, in its page's header and on its card on the Libraries page,
 * as words alone. Each names its library to a screen reader, as the list has
 * the same buttons on every card.
 */
export const LibraryActions = ({
  library,
  isShut,
  actions: { refresh, rescan, rematch },
}: {
  library: Library
  isShut: boolean
  actions: ReturnType<typeof useLibraryActions>
}) => {
  const [isEditing, setEditing] = useState(false)
  const matchType = matchTypeFor(library.settings.kind)
  // Files only leave pending while TMDB answers, so Match again waits on it.
  const metadata = useQuery({ ...metadataHealthQuery, enabled: matchType != null })
  const canMatch = metadata.data?.tmdb === METADATA_SERVICE_STATES.ok
  const whose = <span className="visually-hidden"> {library.name}</span>

  // A locked library's folders stay on the server until the PIN is entered,
  // so Edit asks for it rather than open with none.
  const edit = () => {
    if (isShut) return useUnlockPrompt.getState().ask()
    setEditing(true)
  }

  return (
    <>
      <ButtonLink to={`/libraries/${library.id}/history`}>History{whose}</ButtonLink>
      <AdminOnly>
        <Button
          disabled={refresh.isPending}
          title="Look for new files and fetch ratings again. While a refresh is under way, it scans again and retries what waits."
          onClick={() => refresh.mutate()}
        >
          Refresh{whose}
        </Button>
        <Button
          disabled={isScanning(library.scan) || rescan.isPending}
          onClick={() => rescan.mutate()}
        >
          Rescan{whose}
        </Button>
        {matchType && (
          <Button
            disabled={!canMatch || library.unmatchedCount === 0 || rematch.isPending}
            title={`Search TMDB again for the files no ${matchType} was found for`}
            onClick={() => rematch.mutate()}
          >
            Match again{whose}
          </Button>
        )}
        <Button onClick={edit}>Edit{whose}</Button>
        {isEditing && <LibraryDialog library={library} onClose={() => setEditing(false)} />}
      </AdminOnly>
    </>
  )
}
