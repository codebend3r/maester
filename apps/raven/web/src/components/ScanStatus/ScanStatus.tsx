import { type ScanStatus as Status, isScanning } from '@raven/core'
import { plural } from '@/lib/plural'
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

/** Live scan progress, or when the library was last brought up to date. */
export const ScanStatus = ({ scan }: { scan: Status }) => (
  <div className={styles.status} aria-live="polite">
    {isScanning(scan) ? (
      <>
        <span>
          {scan.state === 'walking'
            ? lookingNote(scan.found)
            : `Indexing ${count.format(scan.processed)} of ${count.format(scan.found)}`}
        </span>
        <progress
          className={styles.bar}
          max={Math.max(scan.found, 1)}
          value={scan.state === 'walking' ? undefined : scan.processed}
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
