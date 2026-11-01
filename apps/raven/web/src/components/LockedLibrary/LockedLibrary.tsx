import { Icon } from '@raven/ui'
import { LOCKED_LIBRARY_COPY } from '@/components/LockedLibrary/copy'
import styles from '@/components/LockedLibrary/LockedLibrary.module.scss'

type LockedLibraryProps = { name: string }

/** Stands where a locked library's videos would be: no client opens it, so it only says so. */
export const LockedLibrary = ({ name }: LockedLibraryProps) => (
  <section className={styles.locked} aria-label={LOCKED_LIBRARY_COPY.locked}>
    <span className={styles.icon}>
      <Icon name="lock" size={28} />
    </span>
    <p className={styles.message}>{LOCKED_LIBRARY_COPY.isLocked(name)}</p>
  </section>
)
