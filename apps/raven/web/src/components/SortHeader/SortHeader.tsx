import type { ReactNode } from 'react'
import { Icon } from '@raven/ui'
import { ARIA_SORTS, type AriaSort } from '@/lib/tableSort'
import styles from '@/components/SortHeader/SortHeader.module.scss'

/** A column header that sorts the table on a click; `aria-sort` says which way it points. */
export const SortHeader = ({
  sort,
  onToggle,
  className,
  children,
}: {
  sort: AriaSort
  onToggle: () => void
  className?: string
  children: ReactNode
}) => (
  <th scope="col" className={className} aria-sort={sort === ARIA_SORTS.none ? undefined : sort}>
    <button type="button" className={styles.button} onClick={onToggle}>
      {children}
      <span
        className={[
          sort === ARIA_SORTS.none ? styles.hint : styles.mark,
          sort === ARIA_SORTS.descending ? styles.flipped : '',
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
