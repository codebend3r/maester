import type { ReactNode } from 'react'
import styles from '@/components/Frame/Frame.module.scss'

type FrameProps = { children: ReactNode }

/** The one layout: the wordmark above a centred card holding the page. */
export const Frame = ({ children }: FrameProps) => (
  <div className={styles.frame}>
    <p className={styles.wordmark}>rookery</p>
    <main className={styles.card}>{children}</main>
  </div>
)
