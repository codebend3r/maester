import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KINDS, type Library } from '@raven/core'
import { Button } from '@raven/ui'
import { BackButton } from '@/components/BackButton/BackButton'
import { LibraryActions, type useLibraryActions } from '@/components/LibraryActions/LibraryActions'
import { LibraryIcon } from '@/components/LibraryIcon/LibraryIcon'
import { RatingsStatus } from '@/components/RatingsStatus/RatingsStatus'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
import { api } from '@/lib/api'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

const count = new Intl.NumberFormat()

type LibraryHeaderProps = {
  titleId: string
  library: Library
  actions: ReturnType<typeof useLibraryActions>
  isShut: boolean
}

/**
 * The library's name, type and counts, how its scan stands, and at their
 * right what can be done to it: its history, Quick scan, Full scan, Update ratings, Match again,
 * Edit, and Lock once open.
 */
export const LibraryHeader = ({ titleId, library, actions, isShut }: LibraryHeaderProps) => {
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
          <RatingsStatus refresh={library.ratingsRefresh} />
        </div>
        <div className={styles.actions}>
          <LibraryActions
            library={library}
            isShut={isShut}
            actions={actions}
            trail={
              settings.locked &&
              !isShut && (
                <Button
                  icon="lock"
                  disabled={relock.isPending}
                  title="Lock this library again: the PIN is asked for it the next time"
                  onClick={() => relock.mutate()}
                >
                  Lock
                </Button>
              )
            }
          />
        </div>
      </div>
    </header>
  )
}
