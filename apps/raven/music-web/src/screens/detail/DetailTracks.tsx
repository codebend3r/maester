import type { ReactNode } from 'react'
import styles from '@/screens/detail/DetailTracks.module.scss'

type DetailTracksProps = {
  /** The rows, each a `DetailTrackRow`. */
  children: ReactNode
}

/** An album's disc's or a playlist's tracks, one under the other. */
export function DetailTracks({ children }: DetailTracksProps) {
  return <ul className={styles.tracks}>{children}</ul>
}
