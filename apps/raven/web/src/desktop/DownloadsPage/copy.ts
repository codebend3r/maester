import { formatBytes, plural, type SpaceView } from '@raven/core'
import { DOWNLOADS_HOSTS, type DownloadsHostKind } from '@/downloads/host'

const formatSpeed = (bytesPerSecond: number): string => `${formatBytes(bytesPerSecond)}/s`

type DownloadedOfProps = { bytes: number; size: number }
type DeleteQuestionProps = { label: string; bytes: number }
type ActionLabelProps = { action: string; label: string }

type ActivityProps = { files: number; speed: number | null }

export const DOWNLOADS_PAGE_COPY = {
  tabs: 'Downloads views',
  manage: 'Manage',
  watch: 'Watch',
  activity: ({ files, speed }: ActivityProps) =>
    `Downloading ${plural({ n: files, one: 'file', many: 'files' })}${
      speed === null ? '' : ` at ${formatSpeed(speed)}`
    }`,
  empty: {
    [DOWNLOADS_HOSTS.desktop]:
      'Nothing downloaded yet. Choose Download on a movie, show, saga, album or playlist to keep it here.',
    [DOWNLOADS_HOSTS.browser]:
      'Nothing downloaded yet. Choose Download on a movie, show or saga to keep it in this browser. Downloads run while raven is open.',
  } as const satisfies Record<DownloadsHostKind, string>,
  pauseAll: 'Pause all',
  resumeAll: 'Resume all',
  showInFinder: 'Show in Finder',
  disk: 'Disk',
  // The Show control and "Other" read as the iPhone and iPad app's do (`apps/raven/app/src/downloads/copy.ts`).
  show: 'Show',
  showAll: 'All',
  showByLibrary: 'By library',
  otherLibrary: 'Other',
  hidden: 'Some downloads are hidden until the library PIN is entered.',
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
  speed: (bytesPerSecond: number) => formatSpeed(bytesPerSecond),
  starting: 'Starting',
  waiting: 'Waiting',
  preparing: (percent: number) => `Preparing ${percent}%`,
  paused: 'Paused',
  failed: (message: string) => `Failed: ${message}`,
  deleteQuestion: ({ label, bytes }: DeleteQuestionProps) =>
    `Delete ${label}? ${formatBytes(bytes)} will be freed.`,
  actionLabel: ({ action, label }: ActionLabelProps) => `${action} ${label}`,
  deleteLabel: (label: string) => `Delete ${label}`,
} as const

export const WATCH_COPY = {
  sort: 'Sort by',
  shuffle: 'Shuffle',
  order: 'Order: ',
  sortInstead: (direction: string) => `Sort ${direction.toLowerCase()} instead`,
  playLabel: (label: string) => `Play ${label}`,
  notReady: 'Not ready to watch yet',
  gridLabel: 'Downloads to watch',
  gridLabelOf: (library: string) => `Downloads to watch from ${library}`,
} as const
