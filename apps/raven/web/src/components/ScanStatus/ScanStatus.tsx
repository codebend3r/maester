import { SCAN_STATES, type ScanStatus as Status, isScanning } from '@raven/core'
import type { ComponentType } from 'react'
import { SCAN_STATUS_COPY } from '@/components/ScanStatus/copy'
import styles from '@/components/ScanStatus/ScanStatus.module.scss'
import { COMMON_COPY } from '@/lib/copy'

const count = new Intl.NumberFormat()

const since = (iso: string): string => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return SCAN_STATUS_COPY.justNow
  if (minutes < 60) return SCAN_STATUS_COPY.minutesAgo(minutes)
  const hours = Math.round(minutes / 60)
  if (hours < 24) return SCAN_STATUS_COPY.hoursAgo(hours)
  return new Date(iso).toLocaleDateString()
}

/** The bar's fill, or no value for a bar that sweeps, with nothing to measure against. */
type Bar = { max: number; value: number | undefined }

type Progress = { note: string; bar: Bar }

const SWEEP: Bar = { max: 1, value: undefined }

type ProgressOfProps = { scan: Status; expected: number; isMusic: boolean }

/**
 * What the running scan is doing, in words and as a bar. The walk counts
 * what it has found against the library's count before the scan, when it
 * has one, and sweeps for a new library; the indexing counts against what the
 * walk found; the matching, which has no count, sweeps.
 */
const progressOf = ({ scan, expected, isMusic }: ProgressOfProps): Progress => {
  const files = isMusic ? COMMON_COPY.tracks : COMMON_COPY.videos
  switch (scan.state) {
    case SCAN_STATES.walking: {
      if (scan.found === 0) {
        return {
          note: SCAN_STATUS_COPY.walking,
          bar: expected > 0 ? { max: expected, value: 0 } : SWEEP,
        }
      }
      if (expected === 0) {
        return {
          note: SCAN_STATUS_COPY.walkingSoFar(files(scan.found)),
          bar: SWEEP,
        }
      }
      return {
        note: SCAN_STATUS_COPY.walkingOf({
          found: count.format(scan.found),
          expected: files(expected),
        }),
        bar: { max: Math.max(expected, scan.found), value: scan.found },
      }
    }
    case SCAN_STATES.matching:
      return {
        note: isMusic ? SCAN_STATUS_COPY.matchingAlbums : SCAN_STATUS_COPY.matching,
        bar: SWEEP,
      }
    case SCAN_STATES.idle:
    case SCAN_STATES.indexing:
      return {
        note: SCAN_STATUS_COPY.indexing({
          processed: count.format(scan.processed),
          found: count.format(scan.found),
        }),
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
    finishedAt ? SCAN_STATUS_COPY.fullScan(since(finishedAt)) : SCAN_STATUS_COPY.noFullScan,
    ...(quickScannedAt ? [SCAN_STATUS_COPY.quickScan(since(quickScannedAt))] : []),
  ].join(COMMON_COPY.separator)
}

/** Whether the scan is running, shown as its progress, or done, shown as when it last ran. */
const SCAN_VIEWS = { scanning: 'scanning', scanned: 'scanned' } as const
type ScanView = (typeof SCAN_VIEWS)[keyof typeof SCAN_VIEWS]

type ScanViewProps = Progress & { scanned: string | null }

type ScanningProps = ScanViewProps

const Scanning = ({ note, bar }: ScanningProps) => (
  <div className={styles.scanning}>
    <span className={styles.note}>{note}</span>
    <progress
      className={styles.bar}
      max={bar.max}
      value={bar.value}
      aria-label={SCAN_STATUS_COPY.progress}
    />
  </div>
)

type ScannedProps = ScanViewProps

const Scanned = ({ scanned }: ScannedProps) => !!scanned && <span>{scanned}</span>

const SCAN_STATUS_VIEWS = {
  [SCAN_VIEWS.scanning]: Scanning,
  [SCAN_VIEWS.scanned]: Scanned,
} as const satisfies Record<ScanView, ComponentType<ScanViewProps>>

type ScanStatusProps = {
  scan: Status
  /** The library's video count before the scan, which a full scan's walk is measured against; 0 for none. */
  expected: number
  isMusic?: boolean
}

/**
 * Live scan progress, a bar with what the scan is doing beside it, or when
 * the library was last brought up to date.
 */
export const ScanStatus = ({ scan, expected, isMusic = false }: ScanStatusProps) => {
  const scanned = scannedNote(scan)
  const { note, bar } = progressOf({ scan, expected, isMusic })
  const View = SCAN_STATUS_VIEWS[isScanning(scan) ? SCAN_VIEWS.scanning : SCAN_VIEWS.scanned]
  return (
    <div className={styles.status} aria-live="polite">
      <View note={note} bar={bar} scanned={scanned} />
      {!!scan.error && (
        <span className={styles.error} role="alert">
          {scan.error}
        </span>
      )}
    </div>
  )
}
