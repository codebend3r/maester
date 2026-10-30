import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KINDS, type Library } from '@raven/core'
import { Button } from '@raven/ui'
import { BackButton } from '@/components/BackButton/BackButton'
import { LibraryActions, type useLibraryActions } from '@/components/LibraryActions/LibraryActions'
import { LibraryIcon } from '@/components/LibraryIcon/LibraryIcon'
import { RatingsStatus } from '@/components/RatingsStatus/RatingsStatus'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
import { api } from '@/lib/api'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

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
      <BackButton
        fallback={{ to: '/libraries', label: COMMON_COPY.libraries }}
        className={styles.back}
      />
      <div className={styles.heading}>
        <h1 id={titleId} className={styles.title}>
          <LibraryIcon settings={settings} size="0.6em" className={styles.titleIcon} />
          <span className={styles.name}>{library.name}</span>
        </h1>
        <p className={styles.count}>
          {KINDS[settings.kind].label}
          {COMMON_COPY.separator}
          {COMMON_COPY.videos(library.itemCount)}
          {unmatched > 0 && LIBRARY_COPY.notMatchedCount(count.format(unmatched))}
        </p>
        <div className={styles.status}>
          <ScanStatus scan={library.scan} expected={library.itemCount} />
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
                  title={LIBRARY_COPY.lockTitle}
                  onClick={() => relock.mutate()}
                >
                  {LIBRARY_COPY.lock}
                </Button>
              )
            }
          />
        </div>
      </div>
    </header>
  )
}
