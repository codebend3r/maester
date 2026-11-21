import { DETAIL_COPY } from '@raven/wren'
import styles from '@/screens/detail/TrackColumns.module.scss'

/**
 * The headings over the wide layout's tracklist: #, Title and Time, lined up with the rows. They
 * are for the eye alone, since each row already says what it is; the narrow layout has none.
 */
export function TrackColumns() {
  return (
    <div aria-hidden="true" className={styles.columns}>
      <span className={styles.number}>{DETAIL_COPY.columns.number}</span>
      <span>{DETAIL_COPY.columns.title}</span>
      <span>{DETAIL_COPY.columns.time}</span>
    </div>
  )
}
