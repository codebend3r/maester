import styles from '@/desktop/DownloadsPage/DownloadActivity.module.scss'

type DownloadActivityProps = {
  value: number
  max: number
  label?: string
  labelledBy?: string
}

/**
 * The gauge of a download on its way, with a light that loops along it while it moves, so a slow
 * one still shows it is alive. The light is for the eyes only, and still under reduced motion.
 */
export const DownloadActivity = ({ value, max, label, labelledBy }: DownloadActivityProps) => (
  <span className={styles.activity}>
    <progress
      className={styles.gauge}
      max={max}
      value={value}
      aria-label={label}
      aria-labelledby={labelledBy}
    />
    <span className={styles.sweep} aria-hidden="true" />
  </span>
)
