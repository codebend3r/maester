import { LIBRARY_WORK_KINDS, type LibraryWorkKind } from '@raven/core'
import { Button, Icon } from '@raven/ui'
import { useServerActiveWork } from '@raven/ui/headless'
import { api } from '@/lib/api'
import { librariesQuery } from '@/lib/queries'
import { ADMIN_COPY } from '@/pages/SettingsPage/adminCopy'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

const WORK_LABELS = {
  [LIBRARY_WORK_KINDS.quickScan]: ADMIN_COPY.quickScan,
  [LIBRARY_WORK_KINDS.fullScan]: ADMIN_COPY.fullScan,
  [LIBRARY_WORK_KINDS.ratings]: ADMIN_COPY.ratings,
} as const satisfies Record<LibraryWorkKind, string>

export const ScanSwitch = () => {
  const { state, running, cancel, error } = useServerActiveWork({ api, librariesQuery })
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        <Icon name="libraries" />
        {ADMIN_COPY.scans}
      </h2>
      <p className={styles.help}>{ADMIN_COPY.hint}</p>
      {state.data && (
        <>
          <ul className={styles.scanList}>
            {running.map(({ library, kind }) => (
              <li key={`${library.id}-${kind}`}>
                {library.name}: {WORK_LABELS[kind]}
              </li>
            ))}
          </ul>
          <Button
            disabled={cancel.isPending || running.length === 0}
            onClick={() => cancel.mutate()}
          >
            {ADMIN_COPY.stop}
          </Button>
        </>
      )}
      {error && <p role="alert">{error.message}</p>}
    </section>
  )
}
