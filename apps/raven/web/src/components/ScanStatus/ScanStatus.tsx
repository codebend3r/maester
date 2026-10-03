import type { ScanStatus as Status } from '@raven/core'
import styles from './ScanStatus.module.scss'

const count = new Intl.NumberFormat()

const since = (iso: string): string => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(iso).toLocaleDateString()
}

/** Live scan progress, or when the library was last brought up to date. */
export const ScanStatus = ({ scan }: { scan: Status }) => (
  <div className={styles.status} aria-live="polite">
    {scan.state === 'scanning' ? (
      <>
        <span>
          {scan.discovered === 0
            ? 'Looking through the folders'
            : `Indexing ${count.format(scan.processed)} of ${count.format(scan.discovered)}`}
        </span>
        <progress
          className={styles.bar}
          max={Math.max(scan.discovered, 1)}
          value={scan.discovered === 0 ? undefined : scan.processed}
          aria-label="Scan progress"
        />
      </>
    ) : (
      !!scan.finishedAt && <span>Scanned {since(scan.finishedAt)}</span>
    )}
    {!!scan.error && (
      <span className={styles.error} role="alert">
        {scan.error}
      </span>
    )}
  </div>
)
