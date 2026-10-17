import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Library } from '@raven/core'
import { Button } from '@raven/ui'
import { BackButton } from '@/components/BackButton/BackButton'
import { LibraryActions, type useLibraryActions } from '@/components/LibraryActions/LibraryActions'
import { LibraryIcon } from '@/components/LibraryIcon/LibraryIcon'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
import { api } from '@/lib/api'
import { KINDS } from '@/lib/libraryKinds'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

const count = new Intl.NumberFormat()

/**
 * The library's name, type and counts, how its scan stands, and at their
 * right what can be done to it: its history, Rescan, Match again, Edit, and
 * Lock once open.
 */
export const LibraryHeader = ({
  titleId,
  library,
  actions,
  isShut,
}: {
  titleId: string
  library: Library
  actions: ReturnType<typeof useLibraryActions>
  isShut: boolean
}) => {
  const queryClient = useQueryClient()
  const relock = useMutation({
    mutationFn: api.lock,
    onSuccess: () => queryClient.invalidateQueries(),
  })
  const { settings } = library
  const unmatched = library.unmatchedCount

  return (
    <header className={styles.header}>
      <BackButton fallback={{ to: '/libraries', label: 'Libraries' }} className={styles.back} />
      <div className={styles.heading}>
        <h1 id={titleId} className={styles.title}>
          <LibraryIcon settings={settings} size="0.6em" className={styles.titleIcon} />
          <span className={styles.name}>{library.name}</span>
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
          <LibraryActions library={library} isShut={isShut} actions={actions} />
          {settings.locked && !isShut && (
            <Button disabled={relock.isPending} onClick={() => relock.mutate()}>
              Lock
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
