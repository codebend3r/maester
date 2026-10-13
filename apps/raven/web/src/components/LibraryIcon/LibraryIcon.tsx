import type { LibrarySettings } from '@raven/core'
import { Icon } from '@/components/Icon/Icon'
import { libraryIconOf } from '@/lib/libraryKinds'
import styles from '@/components/LibraryIcon/LibraryIcon.module.scss'

/**
 * A library's icon, the one it picked or its type's, with a lock laid over
 * its corner when the library is locked. The lock keeps the proportion of
 * the side menu's 12px lock on its 20px icons. A caller's className adds
 * placement.
 */
export const LibraryIcon = ({
  settings,
  size = 20,
  className,
}: {
  settings: Pick<LibrarySettings, 'icon' | 'kind' | 'locked'>
  size?: number
  className?: string
}) => (
  <span className={className ? `${styles.icon} ${className}` : styles.icon}>
    <Icon name={libraryIconOf(settings)} size={size} />
    {settings.locked && (
      <span className={styles.lock}>
        <Icon name="lock" size={Math.round(size * 0.6)} />
      </span>
    )}
  </span>
)
