import type { ReactNode } from 'react'
import styles from './Frame.module.scss'

/** The one layout: the wordmark above a centred card holding the page. */
export const Frame = ({ children }: { children: ReactNode }) => (
  <div className={styles.frame}>
    <p className={styles.wordmark}>rookery</p>
    <main className={styles.card}>{children}</main>
  </div>
)
