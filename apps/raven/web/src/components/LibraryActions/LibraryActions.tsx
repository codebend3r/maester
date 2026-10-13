import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type Library, isScanning, matchTypeFor } from '@raven/core'
import { Button, ButtonLink } from '@/components/Button/Button'
import { api } from '@/lib/api'
import { metadataHealthQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/queryClient'

/** What can be done to a library from its page or its row: lock it again, rescan it, match its files again. */
export const useLibraryActions = (library: Library) => {
  const queryClient = useQueryClient()

  const relock = useMutation({
    mutationFn: api.lock,
    onSuccess: () => queryClient.invalidateQueries(),
  })

  const rescan = useMutation({
    mutationFn: () => api.scanLibrary(library.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.library(library.id), updated)
      return queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
    },
  })

  // Match again sends the files no movie or show was found for back to TMDB;
  // the listing then polls while any of them is pending. The Libraries page
  // reads its list again for the count of files not matched.
  const rematch = useMutation({
    mutationFn: () => api.matchLibrary(library.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.library(library.id), updated)
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.libraries, exact: true }),
        queryClient.invalidateQueries({ queryKey: queryKeys.showLists(library.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.mediaLists(library.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.unmatched(library.id) }),
      ])
    },
  })

  return { relock, rescan, rematch }
}

/**
 * A library's history, Rescan, Match again and Edit, in its page's header and
 * in its row on the Libraries page. In the list, where every row has the same
 * buttons, each says whose it is.
 */
export const LibraryActions = ({
  library,
  actions: { rescan, rematch },
  isInList = false,
  onEdit,
}: {
  library: Library
  actions: ReturnType<typeof useLibraryActions>
  isInList?: boolean
  onEdit: () => void
}) => {
  const matchType = matchTypeFor(library.settings.kind)
  // Files only leave pending while TMDB answers, so Match again waits on it.
  const metadata = useQuery({ ...metadataHealthQuery, enabled: matchType != null })
  const canMatch = metadata.data?.tmdb === 'ok'
  const whose = isInList && <span className="visually-hidden"> {library.name}</span>

  return (
    <>
      <ButtonLink to={`/libraries/${library.id}/history`} icon="history">
        History{whose}
      </ButtonLink>
      <Button
        icon="rescan"
        disabled={isScanning(library.scan) || rescan.isPending}
        onClick={() => rescan.mutate()}
      >
        Rescan{whose}
      </Button>
      {matchType && (
        <Button
          icon="search"
          disabled={!canMatch || library.unmatchedCount === 0 || rematch.isPending}
          title={`Search TMDB again for the files no ${matchType} was found for`}
          onClick={() => rematch.mutate()}
        >
          Match again{whose}
        </Button>
      )}
      <Button icon="edit" onClick={onEdit}>
        Edit{whose}
      </Button>
    </>
  )
}
