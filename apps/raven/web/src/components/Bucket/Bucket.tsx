import type { ReactNode } from 'react'
import { useId } from 'react'
import { Icon } from '@raven/ui'
import styles from '@/components/Bucket/Bucket.module.scss'

type BucketProps = {
  label: string
  /** "1,189 videos", "113 shows". */
  count: string
  children: ReactNode
}

/**
 * One folded row of a bucketed page: its heading and count show, and a
 * click opens what it holds. Closed to start, so a long library reads as
 * its buckets first.
 */
export const Bucket = ({ label, count, children }: BucketProps) => {
  const id = useId()
  return (
    <details className={styles.bucket}>
      <summary className={styles.summary} aria-labelledby={id}>
        <h2 id={id} className={styles.heading}>
          {label}
          <span className="visually-hidden">, </span>
          <span className={styles.count}>{count}</span>
        </h2>
        <span className={styles.chevron} aria-hidden="true">
          <Icon name="up" size={18} />
        </span>
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  )
}
