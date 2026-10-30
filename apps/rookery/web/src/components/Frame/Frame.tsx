import type { ReactNode } from 'react'
import styles from '@/components/Frame/Frame.module.scss'
import { FRAME_COPY } from '@/components/Frame/copy'

type FrameProps = { children: ReactNode }

/** The one layout: the wordmark above a centred card holding the page. */
export const Frame = ({ children }: FrameProps) => (
  <div className={styles.frame}>
    <p className={styles.wordmark}>{FRAME_COPY.wordmark}</p>
    <main className={styles.card}>{children}</main>
  </div>
)
