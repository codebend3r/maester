import type { Library } from '@raven/core'
import { Button } from '@/components/Button/Button'
import { LibraryActions, type useLibraryActions } from '@/components/LibraryActions/LibraryActions'
import { LibraryIcon } from '@/components/LibraryIcon/LibraryIcon'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
import { KINDS } from '@/lib/libraryKinds'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

const count = new Intl.NumberFormat()

/**
 * The library's name, type and counts, how its scan stands, and what can be
 * done to it: its history, Rescan, Match again, Edit, and Lock once open.
 */
export const LibraryHeader = ({
  titleId,
  library,
  actions,
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
  const unmatched = library.unmatchedCount

  return (
    <header className={styles.header}>
      <h1 id={titleId} className={styles.title}>
        <LibraryIcon settings={settings} size="0.7em" />
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
        <LibraryActions library={library} actions={actions} onEdit={onEdit} />
        {settings.locked && !isShut && (
          <Button
            icon="lock"
            disabled={actions.relock.isPending}
            onClick={() => actions.relock.mutate()}
          >
            Lock
          </Button>
        )}
      </div>
    </header>
  )
}
