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

/** The bar's fill, or no value for a bar that sweeps, with nothing to measure against. */
type Bar = { max: number; value: number | undefined }

type Progress = { note: string; bar: Bar }

const SWEEP: Bar = { max: 1, value: undefined }

const videos = (n: number): string => plural({ n, one: 'video', many: 'videos' })

type ProgressOfProps = { scan: Status; expected: number }

/**
 * What the running scan is doing, in words and as a bar. The walk counts
 * what it has found against the library's count before the scan, when it
 * has one, and sweeps for a new library; the indexing counts against what the
 * walk found; the matching, which has no count, sweeps.
 */
const progressOf = ({ scan, expected }: ProgressOfProps): Progress => {
  switch (scan.state) {
    case SCAN_STATES.walking: {
      if (scan.found === 0) {
        return {
          note: 'Looking through the folders',
          bar: expected > 0 ? { max: expected, value: 0 } : SWEEP,
        }
      }
      if (expected === 0) {
        return {
          note: `Looking through the folders, ${videos(scan.found)} found so far`,
          bar: SWEEP,
        }
      }
      return {
        note: `Looking through the folders, ${count.format(scan.found)} of about ${videos(expected)} found`,
        bar: { max: Math.max(expected, scan.found), value: scan.found },
      }
    }
    case SCAN_STATES.matching:
      return { note: 'Matching the new videos', bar: SWEEP }
    case SCAN_STATES.idle:
    case SCAN_STATES.indexing:
      return {
        note: `Indexing ${count.format(scan.processed)} of ${count.format(scan.found)}`,
        bar: { max: Math.max(scan.found, 1), value: scan.processed },
      }
    default: {
      const unreachable: never = scan.state
      return unreachable
    }
  }
}

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

type ScanStatusProps = {
  scan: Status
  /** The library's video count before the scan, which a full scan's walk is measured against; 0 for none. */
  expected: number
}

/**
 * Live scan progress, a bar with what the scan is doing beside it, or when
 * the library was last brought up to date.
 */
export const ScanStatus = ({ scan, expected }: ScanStatusProps) => {
  const scanned = scannedNote(scan)
  const { note, bar } = progressOf({ scan, expected })
  return (
    <div className={styles.status} aria-live="polite">
      {isScanning(scan) ? (
        <div className={styles.scanning}>
          <span className={styles.note}>{note}</span>
          <progress
            className={styles.bar}
            max={bar.max}
            value={bar.value}
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
