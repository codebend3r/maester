import { formatBytes, plural, type SpaceView } from '@raven/core'

type DownloadedOfProps = { bytes: number; size: number }
type DeleteQuestionProps = { label: string; bytes: number }
type ActionLabelProps = { action: string; label: string }

export const DOWNLOADS_PAGE_COPY = {
  empty: 'Nothing downloaded yet. Choose Download on a movie, show or saga to keep it here.',
  pauseAll: 'Pause all',
  resumeAll: 'Resume all',
  showInFinder: 'Show in Finder',
  disk: 'Disk',
  space: ({ used, free, total }: SpaceView) =>
    `${formatBytes(used)} of downloads · ${formatBytes(free)} free of ${formatBytes(total)}`,
} as const

export const DOWNLOAD_ROW_COPY = {
  resume: 'Resume',
  retry: 'Retry',
  deletesIn: (minutes: number) =>
    `Deletes in ${plural({ n: minutes, one: 'minute', many: 'minutes' })}`,
  downloadedOf: ({ bytes, size }: DownloadedOfProps) =>
    `${formatBytes(bytes)} of ${formatBytes(size)}`,
  waiting: 'Waiting',
  paused: 'Paused',
  failed: (message: string) => `Failed: ${message}`,
  deleteQuestion: ({ label, bytes }: DeleteQuestionProps) =>
    `Delete ${label}? ${formatBytes(bytes)} will be freed.`,
  actionLabel: ({ action, label }: ActionLabelProps) => `${action} ${label}`,
  deleteLabel: (label: string) => `Delete ${label}`,
  lockedHint: 'This download is in a locked library. Enter the PIN to go on downloading it.',
} as const
