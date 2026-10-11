import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Library, LibrarySettings } from '@raven/core'
import { Button, ButtonLink } from '@/components/Button/Button'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
import { api } from '@/lib/api'
import { KINDS } from '@/lib/libraryKinds'
import { queryKeys } from '@/lib/queryClient'
import { matchTypeOf } from '@/pages/LibraryPage/libraryShape'
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
  settings,
  actions: { relock, rescan, rematch },
  canMatch,
  shut,
  onEdit,
}: {
  titleId: string
  library: Library
  settings: LibrarySettings
  actions: ReturnType<typeof useLibraryActions>
  canMatch: boolean
  shut: boolean
  onEdit: () => void
}) => {
  const scanning = library.scan.state === 'scanning'
  const matchType = matchTypeOf(settings.kind)
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
        {settings.locked && !shut && (
          <Button icon="lock" disabled={relock.isPending} onClick={() => relock.mutate()}>
            Lock
          </Button>
        )}
      </div>
    </header>
  )
}
