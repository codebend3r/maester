import type { ReactNode } from 'react'
import styles from '@/components/SectionHeading/SectionHeading.module.scss'

/**
 * A section's heading in the large serif, ruled off from what follows, with
 * room at its right for a count or the section's own controls (a scroller's
 * previous and next). `id` is for the section's `aria-labelledby`.
 */
export const SectionHeading = ({
  id,
  children,
  aside,
}: {
  id?: string
  children: ReactNode
  aside?: ReactNode
}) => (
  <header className={styles.head}>
    <h2 id={id} className={styles.title}>
      {children}
    </h2>
    {!!aside && <div className={styles.aside}>{aside}</div>}
  </header>
)
