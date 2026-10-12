import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type Library, isScanning, matchTypeFor } from '@raven/core'
import { Button, ButtonLink } from '@/components/Button/Button'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
import { api } from '@/lib/api'
import { KINDS } from '@/lib/libraryKinds'
import { metadataHealthQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/queryClient'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

const count = new Intl.NumberFormat()

/** What can be done to a library from its page: lock it again, rescan it, match its files again. */
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
  // the listing then polls while any of them is pending.
  const rematch = useMutation({
    mutationFn: () => api.matchLibrary(library.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.library(library.id), updated)
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.showLists(library.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.mediaLists(library.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.unmatched(library.id) }),
      ])
    },
  })

  return { relock, rescan, rematch }
}

/**
 * The library's name, type and counts, how its scan stands, and what can be
 * done to it: its history, Rescan, Match again, Edit, and Lock once open.
 */
export const LibraryHeader = ({
  titleId,
  library,
  actions: { relock, rescan, rematch },
  isShut,
  onEdit,
}: {
  titleId: string
  library: Library
  actions: ReturnType<typeof useLibraryActions>
  isShut: boolean
  onEdit: () => void
}) => {
  const { settings } = library
  const scanning = isScanning(library.scan)
  const matchType = matchTypeFor(settings.kind)
  // Files only leave pending while TMDB answers, so Match again waits on it.
  const metadata = useQuery({ ...metadataHealthQuery, enabled: matchType != null })
  const canMatch = metadata.data?.tmdb === 'ok'
  const unmatched = library.unmatchedCount

  return (
    <header className={styles.header}>
      <h1 id={titleId} className={styles.title}>
        {library.name}
      </h1>
      <p className={styles.count}>
        {KINDS[settings.kind].label} · {count.format(library.itemCount)}{' '}
        {library.itemCount === 1 ? 'video' : 'videos'}
        {unmatched > 0 && ` · ${count.format(unmatched)} not matched`}
      </p>
      <div className={styles.status}>
        <ScanStatus scan={library.scan} />
      </div>
      <div className={styles.actions}>
        <ButtonLink to={`/libraries/${library.id}/history`} icon="history">
          History
        </ButtonLink>
        <Button
          icon="rescan"
          disabled={scanning || rescan.isPending}
          onClick={() => rescan.mutate()}
        >
          Rescan
        </Button>
        {matchType && (
          <Button
            icon="search"
            disabled={!canMatch || unmatched === 0 || rematch.isPending}
            title={`Search TMDB again for the files no ${matchType} was found for`}
            onClick={() => rematch.mutate()}
          >
            Match again
          </Button>
        )}
        <Button icon="edit" onClick={onEdit}>
          Edit
        </Button>
        {settings.locked && !isShut && (
          <Button icon="lock" disabled={relock.isPending} onClick={() => relock.mutate()}>
            Lock
          </Button>
        )}
      </div>
    </header>
  )
}
