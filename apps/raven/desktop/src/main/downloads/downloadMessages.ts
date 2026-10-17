import type { DownloadKind } from '@/shared/protocol'

/** What the files of an ask of each kind are called, many at a time. */
const FILE_NOUNS = {
  movie: 'movies',
  saga: 'movies',
  episode: 'episodes',
  season: 'episodes',
  show: 'episodes',
} as const satisfies Record<DownloadKind, string>

export const DOWNLOAD_MESSAGES = {
  askGone:
    'That download request has expired. Open the title in raven on the web and choose Download to raven player again.',
  unknown: 'That download is no longer in raven player.',
  queued: ({
    files,
    kind,
    label,
    serverName,
  }: {
    files: number
    kind: DownloadKind
    label: string
    serverName: string
  }): string =>
    files === 1
      ? `Downloading ${label} from ${serverName}`
      : `Downloading ${files} ${FILE_NOUNS[kind]} from ${serverName}`,
  noSpace: 'Not enough space',
  changed: 'The file changed on the server',
  answered: ({ serverName, status }: { serverName: string; status: number }): string =>
    `${serverName} answered ${status}`,
  relocked: (name: string): string => `${name} locked this library again`,
  unreachable: (name: string): string => `${name} could not be reached`,
  downloaded: (label: string): string => `Downloaded ${label}`,
  failed: ({ label, why }: { label: string; why: string }): string =>
    `Could not download ${label}: ${why}`,
  deletedAfterWatching: (label: string): string => `Deleted ${label} after watching`,
} as const
