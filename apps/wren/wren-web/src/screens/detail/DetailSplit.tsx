import type { ReactNode } from 'react'
import { TrackColumns } from '@/screens/detail/TrackColumns'
import { Page } from '@/shell/Page/Page'
import styles from '@/screens/detail/DetailSplit.module.scss'

type DetailSplitProps = {
  /** The album's or the playlist's head. */
  head: ReactNode
  /** Its tracks. */
  children: ReactNode
}

/**
 * An album's or a playlist's page: its head and its tracks. Under `48rem` the head sits above
 * the tracks, as on the apps' phone; from there it is a column of its own with the tracklist
 * beside it under its headings, as on their tablet.
 */
export function DetailSplit({ head, children }: DetailSplitProps) {
  return (
    <Page className={styles.split}>
      <div className={styles.head}>{head}</div>
      <div className={styles.list}>
        <TrackColumns />
        {children}
      </div>
    </Page>
  )
}
