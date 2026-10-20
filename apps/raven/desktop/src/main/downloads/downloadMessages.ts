import { AUTH_REFUSALS, type AuthRefusal } from '@raven/core'
import {
  FAIL_REASONS,
  PAUSE_REASONS,
  type FailReason,
  type PauseReason,
} from '@/main/downloads/downloadState'
import { EXPAND_MESSAGES } from '@/main/downloads/expand'
import { DOWNLOAD_KINDS, SERVER_GONE, type DownloadKind } from '@/shared/protocol'

/** What the files of an ask of each kind are called, many at a time. */
const FILE_NOUNS = {
  [DOWNLOAD_KINDS.movie]: 'movies',
  [DOWNLOAD_KINDS.saga]: 'movies',
  [DOWNLOAD_KINDS.episode]: 'episodes',
  [DOWNLOAD_KINDS.season]: 'episodes',
  [DOWNLOAD_KINDS.show]: 'episodes',
} as const satisfies Record<DownloadKind, string>

export const DOWNLOAD_MESSAGES = {
  askGone:
    'That download request has expired. Open the title in raven on the web and choose Download to raven player again.',
  unknown: 'That download is no longer in raven player.',
  fileGone: "That download's file could not be found.",
  /** With no name, the server is no longer in raven player, and its folder would name a media id. */
  downloadedFrom: (serverName: string): string =>
    serverName === '' ? 'Downloaded' : `Downloaded from ${serverName}`,
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
  signInAgain: (name: string): string => `Sign in to ${name} again`,
  waiting: (name: string): string => `Your account on ${name} is waiting for approval`,
  removed: (name: string): string => `Your access to ${name} was removed`,
  unreachable: (name: string): string => `${name} could not be reached`,
  downloaded: (label: string): string => `Downloaded ${label}`,
  failed: ({ label, why }: { label: string; why: string }): string =>
    `Could not download ${label}: ${why}`,
  deletedAfterWatching: (label: string): string => `Deleted ${label} after watching`,
} as const

/** A refusal of the account itself; `unavailable` is the server's outage, not the account's. */
export type AccountRefusal = Exclude<AuthRefusal['reason'], typeof AUTH_REFUSALS.unavailable>

/** What a download refused for its account says, by why the server refused it. */
export const accountRefusedMessage = ({
  reason,
  serverName,
}: {
  reason: AccountRefusal
  serverName: string
}): string => {
  switch (reason) {
    case AUTH_REFUSALS.signedOut:
      return DOWNLOAD_MESSAGES.signInAgain(serverName)
    case AUTH_REFUSALS.pending:
      return DOWNLOAD_MESSAGES.waiting(serverName)
    case AUTH_REFUSALS.revoked:
    case AUTH_REFUSALS.notOwner:
      return DOWNLOAD_MESSAGES.removed(serverName)
    default: {
      const unreachable: never = reason
      return unreachable
    }
  }
}

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
    case PAUSE_REASONS.viewer:
      return null
    case PAUSE_REASONS.noSpace:
      return DOWNLOAD_MESSAGES.noSpace
    case PAUSE_REASONS.relocked:
      return naming({ serverName, words: DOWNLOAD_MESSAGES.relocked })
    case PAUSE_REASONS.unreachable:
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
    case FAIL_REASONS.noSpace:
      return DOWNLOAD_MESSAGES.noSpace
    case FAIL_REASONS.changed:
      return DOWNLOAD_MESSAGES.changed
    case FAIL_REASONS.unauthorized:
      return naming({
        serverName,
        words: (name) => DOWNLOAD_MESSAGES.answered({ serverName: name, status: 401 }),
      })
    case FAIL_REASONS.unreachable:
      return naming({ serverName, words: DOWNLOAD_MESSAGES.unreachable })
    case FAIL_REASONS.gone:
      return naming({ serverName, words: EXPAND_MESSAGES.gone })
    case FAIL_REASONS.other:
      return message
    default: {
      const unreachable: never = reason
      return unreachable
    }
  }
}
