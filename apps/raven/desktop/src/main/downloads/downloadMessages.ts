import { AUTH_REFUSALS, type AuthRefusal, DOWNLOAD_KINDS, type DownloadKind } from '@raven/core'
import { SERVER_GONE } from '@/main/desktopConfig'
import {
  FAIL_REASONS,
  PAUSE_REASONS,
  type FailReason,
  type PauseReason,
} from '@/main/downloads/downloadState'
import { EXPAND_MESSAGES } from '@/main/downloads/expand'

/** What the files of an ask of each kind are called, many at a time. */
const FILE_NOUNS = {
  [DOWNLOAD_KINDS.movie]: 'movies',
  [DOWNLOAD_KINDS.saga]: 'movies',
  [DOWNLOAD_KINDS.episode]: 'episodes',
  [DOWNLOAD_KINDS.season]: 'episodes',
  [DOWNLOAD_KINDS.show]: 'episodes',
  [DOWNLOAD_KINDS.album]: 'tracks',
  [DOWNLOAD_KINDS.playlist]: 'tracks',
} as const satisfies Record<DownloadKind, string>

type QueuedProps = {
  files: number
  kind: DownloadKind
  label: string
  serverName: string
}

type AnsweredProps = { serverName: string; status: number }

type FailedProps = { label: string; why: string }

export const DOWNLOAD_MESSAGES = {
  askGone:
    'That download request has expired. Open the title in raven on the web and choose Download to Raven again.',
  unknown: 'That download is no longer in Raven.',
  fileGone: "That download's file could not be found.",
  /** With no name, the server is no longer in Raven, and its folder would name a media id. */
  downloadedFrom: (serverName: string): string =>
    serverName === '' ? 'Downloaded' : `Downloaded from ${serverName}`,
  queued: ({ files, kind, label, serverName }: QueuedProps): string =>
    files === 1
      ? `Downloading ${label} from ${serverName}`
      : `Downloading ${files} ${FILE_NOUNS[kind]} from ${serverName}`,
  noSpace: 'Not enough space',
  changed: 'The file changed on the server',
  answered: ({ serverName, status }: AnsweredProps): string => `${serverName} answered ${status}`,
  relocked: (name: string): string => `${name} locked this library again`,
  signInAgain: (name: string): string => `Sign in to ${name} again`,
  waiting: (name: string): string => `Your account on ${name} is waiting for approval`,
  removed: (name: string): string => `Your access to ${name} was removed`,
  unreachable: (name: string): string => `${name} could not be reached`,
  downloaded: (label: string): string => `Downloaded ${label}`,
  failed: ({ label, why }: FailedProps): string => `Could not download ${label}: ${why}`,
  deletedAfterWatching: (label: string): string => `Deleted ${label} after watching`,
} as const

/** A refusal of the account itself; `unavailable` is the server's outage, not the account's. */
export type AccountRefusal = Exclude<AuthRefusal['reason'], typeof AUTH_REFUSALS.unavailable>

type AccountRefusedMessageProps = {
  reason: AccountRefusal
  serverName: string
}

/** What a download refused for its account says, by why the server refused it. */
export const accountRefusedMessage = ({
  reason,
  serverName,
}: AccountRefusedMessageProps): string => {
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

type NamingProps = {
  serverName: string
  words: (name: string) => string
}

/** Words that name the server; with no name, the server is no longer in Raven. */
const naming = ({ serverName, words }: NamingProps): string =>
  serverName === '' ? SERVER_GONE : words(serverName)

type PausedMessageProps = {
  reason: PauseReason
  serverName: string
}

/** What a paused row says, by its reason and its server's name now; null for the viewer's own pause. */
export const pausedMessage = ({ reason, serverName }: PausedMessageProps): string | null => {
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

type FailedMessageProps = {
  reason: FailReason
  message: string
  serverName: string
}

/** What a failed row says, by its reason and its server's name now; `other` says its own words. */
export const failedMessage = ({ reason, message, serverName }: FailedMessageProps): string => {
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
