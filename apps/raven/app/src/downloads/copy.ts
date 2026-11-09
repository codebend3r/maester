import { formatBytes } from '@raven/core'

type CountProps = { done: number; total: number }

type SeasonProps = { title: string; season: number }

/** What the downloads say, on the Download buttons and in Downloads. */
export const DOWNLOAD_COPY = {
  title: 'Downloads',
  /** Between the facts of one line: "3 episodes · 4.2 GB". */
  separator: ' · ',
  download: 'Download',
  downloadAll: (what: string) => `Download ${what}`,
  queued: 'Queued',
  preparing: (percent: number) => `Preparing on server ${percent}%`,
  /** A queued copy the server has finished making, waiting only for its turn. */
  readyOnServer: 'Ready on server',
  downloading: (percent: number) => `${percent}%`,
  downloadingSome: ({ done, total }: CountProps) => `Downloading ${done} of ${total}`,
  downloaded: 'Downloaded',
  deleteDownload: 'Delete download',
  retry: 'Retry',
  retryDownload: 'Retry download',
  cancelDownload: (title: string) => `Cancel downloading ${title}`,
  playTitle: (title: string) => `Play ${title}`,
  deleteTitle: (title: string) => `Delete ${title}`,
  deleteAll: 'Delete all',
  deleteAllAsk: 'Delete every download on this device?',
  keep: 'Keep',
  available: (bytes: number) => `${formatBytes(bytes)} available`,
  used: (bytes: number) => `Downloads use ${formatBytes(bytes)}`,
  /** How long a download will take at its current speed: "finished in 36m". */
  finishedIn: (duration: string) => `finished in ${duration}`,
  progress: ({ done, total }: CountProps) =>
    total > 0 ? `${formatBytes(done)} of ${formatBytes(total)}` : formatBytes(done),
  underway: 'Downloading',
  finished: 'On this device',
  /** The picker over the finished downloads: everything, or by library. */
  show: 'Show',
  showAll: 'All',
  showByLibrary: 'By library',
  /** The library section for downloads whose library is unknown. */
  otherLibrary: 'Other',
  /** The sheet a long press on a finished download opens. */
  play: 'Play',
  playAll: 'Play all',
  none: 'Nothing downloaded yet. Download a movie, a show or an album from its page.',
  notHere: 'Downloads are on iPhone and iPad.',
  cantDownload: "This video can't be downloaded to this device.",
  unreachable: "The server this download is on can't be reached.",
  failed: "The download didn't finish.",
  season: ({ title, season }: SeasonProps) => `${title} · Season ${season}`,
  seasonNumber: (season: number) => `Season ${season}`,
  episodes: (count: number) => (count === 1 ? '1 episode' : `${count} episodes`),
  tracks: (count: number) => (count === 1 ? '1 track' : `${count} tracks`),
} as const
