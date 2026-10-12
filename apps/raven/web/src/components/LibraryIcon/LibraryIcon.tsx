import type { LibraryKind } from '@raven/core'
import { Icon } from '@/components/Icon/Icon'
import { KINDS } from '@/lib/libraryKinds'
import styles from '@/components/LibraryIcon/LibraryIcon.module.scss'

/**
 * A library's type icon, with a lock laid over its corner when the library is
 * locked, whatever its type. The lock keeps the proportion of the side menu's
 * 12px lock on its 20px icons. A caller's className adds placement.
 */
export const LibraryIcon = ({
  kind,
  isLocked,
  size = 20,
  className,
}: {
  kind: LibraryKind
  isLocked: boolean
  size?: number
  className?: string
}) => (
  <span className={className ? `${styles.icon} ${className}` : styles.icon}>
    <Icon name={KINDS[kind].icon} size={size} />
    {isLocked && (
      <span className={styles.lock}>
        <Icon name="lock" size={Math.round(size * 0.6)} />
      </span>
    )}
  </span>
)
