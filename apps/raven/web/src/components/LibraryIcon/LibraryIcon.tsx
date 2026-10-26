import { type LibrarySettings, libraryIconOf } from '@raven/core'
import { Icon, type IconSize } from '@raven/ui'
import styles from '@/components/LibraryIcon/LibraryIcon.module.scss'

type LibraryIconProps = {
  settings: Pick<LibrarySettings, 'icon' | 'kind' | 'locked'>
  size?: IconSize
  className?: string
}

/**
 * A library's icon, the one it picked or its type's, with a lock laid over
 * its corner when the library is locked. Both are drawn in ems of `size`, so
 * the lock keeps the proportion of the side menu's 12px lock on its 20px
 * icons at any size. A caller's className adds placement.
 */
export const LibraryIcon = ({ settings, size = 20, className }: LibraryIconProps) => (
  <span
    className={className ? `${styles.icon} ${className}` : styles.icon}
    style={{ fontSize: size }}
  >
    <Icon name={libraryIconOf(settings)} size="1em" />
    {settings.locked && (
      <span className={styles.lock}>
        <Icon name="lock" size="0.6em" />
      </span>
    )}
  </span>
)
