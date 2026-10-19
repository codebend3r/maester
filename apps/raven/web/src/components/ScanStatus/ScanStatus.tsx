import { SCAN_STATES, type ScanStatus as Status, isScanning, plural } from '@raven/core'
import styles from '@/components/ScanStatus/ScanStatus.module.scss'

const count = new Intl.NumberFormat()

const since = (iso: string): string => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(iso).toLocaleDateString()
}

/** While the walk looks: how many videos it has found so far, once it has found any. */
const lookingNote = (found: number): string =>
  found === 0
    ? 'Looking through the folders'
    : `Looking through the folders, ${plural({ n: found, one: 'video', many: 'videos' })} found so far`

/**
 * When the library was last fully scanned and last quick-scanned, as far as
 * either has run: "Full scan 2 h ago · Quick scan 4 min ago". A library
 * quick-scanned but never fully scanned since the times were kept says so.
 */
const scannedNote = ({ finishedAt, quickScannedAt }: Status): string | null => {
  if (!finishedAt && !quickScannedAt) return null
  return [
    finishedAt ? `Full scan ${since(finishedAt)}` : 'No full scan yet',
    ...(quickScannedAt ? [`Quick scan ${since(quickScannedAt)}`] : []),
  ].join(' · ')
}

/**
 * Live scan progress, a bar with what the scan is doing beside it, or when
 * the library was last brought up to date.
 */
export const ScanStatus = ({ scan }: { scan: Status }) => {
  const scanned = scannedNote(scan)
  return (
    <div className={styles.status} aria-live="polite">
      {isScanning(scan) ? (
        <div className={styles.scanning}>
          <span className={styles.note}>
            {scan.state === SCAN_STATES.walking
              ? lookingNote(scan.found)
              : `Indexing ${count.format(scan.processed)} of ${count.format(scan.found)}`}
          </span>
          <progress
            className={styles.bar}
            max={Math.max(scan.found, 1)}
            value={scan.state === SCAN_STATES.walking ? undefined : scan.processed}
            aria-label="Scan progress"
          />
        </div>
      ) : (
        !!scanned && <span>{scanned}</span>
      )}
      {!!scan.error && (
        <span className={styles.error} role="alert">
          {scan.error}
        </span>
      )}
    </div>
  )
}
