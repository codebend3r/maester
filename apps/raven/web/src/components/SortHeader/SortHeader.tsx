import type { ReactNode } from 'react'
import { Icon } from '@/components/Icon/Icon'
import styles from '@/components/SortHeader/SortHeader.module.scss'

/** A column header that sorts the table on a click; `aria-sort` says which way it points. */
export const SortHeader = ({
  sort,
  onToggle,
  className,
  children,
}: {
  sort: 'ascending' | 'descending' | 'none'
  onToggle: () => void
  className?: string
  children: ReactNode
}) => (
  <th scope="col" className={className} aria-sort={sort === 'none' ? undefined : sort}>
    <button type="button" className={styles.button} onClick={onToggle}>
      {children}
      <span
        className={[
          sort === 'none' ? styles.hint : styles.mark,
          sort === 'descending' ? styles.flipped : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-hidden="true"
      >
        <Icon name="up" size={12} />
      </span>
    </button>
  </th>
)
