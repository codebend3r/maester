import type { ShortcutRow } from '@raven/core'
import styles from '@/components/Player/ShortcutList.module.scss'

type ShortcutListProps = { rows: readonly ShortcutRow[]; className?: string }

/** Keys and what each does, over the picture: the `?` dialog's list and the first video's tip. */
export const ShortcutList = ({ rows, className }: ShortcutListProps) => (
  <dl className={className ? `${styles.list} ${className}` : styles.list}>
    {rows.map(({ keys, action }) => (
      <div key={action} className={styles.row}>
        <dt className={styles.keys}>
          {keys.map((key) => (
            <kbd key={key} className={styles.key}>
              {key}
            </kbd>
          ))}
        </dt>
        <dd className={styles.action}>{action}</dd>
      </div>
    ))}
  </dl>
)
