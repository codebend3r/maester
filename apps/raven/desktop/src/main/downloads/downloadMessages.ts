import type { FailReason, PauseReason } from '@/main/downloads/downloadState'
import { EXPAND_MESSAGES } from '@/main/downloads/expand'
import { SERVER_GONE, type DownloadKind } from '@/shared/protocol'

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
  fileGone: "That download's file could not be found.",
  downloadedFrom: (serverName: string): string => `Downloaded from ${serverName}`,
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

/** Words that name the server; with no name, the server is no longer in raven player. */
const naming = ({
  serverName,
  words,
}: {
  serverName: string
  words: (name: string) => string
}): string => (serverName === '' ? SERVER_GONE : words(serverName))

/** What a paused row says, by its reason and its server's name now; null for the viewer's own pause. */
export const pausedMessage = ({
  reason,
  serverName,
}: {
  reason: PauseReason
  serverName: string
}): string | null => {
  switch (reason) {
    case 'viewer':
      return null
    case 'noSpace':
      return DOWNLOAD_MESSAGES.noSpace
    case 'relocked':
      return naming({ serverName, words: DOWNLOAD_MESSAGES.relocked })
    case 'unreachable':
      return naming({ serverName, words: DOWNLOAD_MESSAGES.unreachable })
    default: {
      const unreachable: never = reason
      return unreachable
    }
  }
}

/** What a failed row says, by its reason and its server's name now; `other` says its own words. */
export const failedMessage = ({
  reason,
  message,
  serverName,
}: {
  reason: FailReason
  message: string
  serverName: string
}): string => {
  switch (reason) {
    case 'noSpace':
      return DOWNLOAD_MESSAGES.noSpace
    case 'changed':
      return DOWNLOAD_MESSAGES.changed
    case 'unauthorized':
      return naming({
        serverName,
        words: (name) => DOWNLOAD_MESSAGES.answered({ serverName: name, status: 401 }),
      })
    case 'unreachable':
      return naming({ serverName, words: DOWNLOAD_MESSAGES.unreachable })
    case 'gone':
      return naming({ serverName, words: EXPAND_MESSAGES.gone })
    case 'other':
      return message
    default: {
      const unreachable: never = reason
      return unreachable
    }
  }
}
