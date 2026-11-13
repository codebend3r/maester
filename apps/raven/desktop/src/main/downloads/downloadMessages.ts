import { AUTH_REFUSALS, DOWNLOAD_KINDS, type DownloadKind } from '@raven/core'
import { SERVER_NAME } from '@/main/desktopConfig'
import {
  FAIL_REASONS,
  type Failure,
  PAUSE_REASONS,
  type PauseReason,
} from '@/main/downloads/downloadState'
import { EXPAND_MESSAGES } from '@/main/downloads/expand'
import type { AccountRefusal } from '@/main/servers/authRefusals'

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
}

type FailedProps = { label: string; why: string }

export const DOWNLOAD_MESSAGES = {
  askGone:
    'That download request has expired. Open the title in raven on the web and choose Download to Raven again.',
  unknown: 'That download is no longer in Raven.',
  fileGone: "That download's file could not be found.",
  downloadedFrom: `Downloaded from ${SERVER_NAME}`,
  /** A download of a server an older Raven kept besides: its folder would name a media id. */
  downloadedElsewhere: 'Downloaded',
  queued: ({ files, kind, label }: QueuedProps): string =>
    files === 1
      ? `Downloading ${label} from ${SERVER_NAME}`
      : `Downloading ${files} ${FILE_NOUNS[kind]} from ${SERVER_NAME}`,
  noSpace: 'Not enough space',
  changed: 'The file changed on the server',
  answered: (status: number): string => `${SERVER_NAME} answered ${status}`,
  relocked: `${SERVER_NAME} locked this library again`,
  signInAgain: `Sign in to ${SERVER_NAME} again`,
  waiting: `Your account on ${SERVER_NAME} is waiting for approval`,
  removed: `Your access to ${SERVER_NAME} was removed`,
  unreachable: `${SERVER_NAME} could not be reached`,
  downloaded: (label: string): string => `Downloaded ${label}`,
  failed: ({ label, why }: FailedProps): string => `Could not download ${label}: ${why}`,
  deletedAfterWatching: (label: string): string => `Deleted ${label} after watching`,
} as const

/** What a download refused for its account says, by why the server refused it. */
const ACCOUNT_REFUSED_MESSAGES = {
  [AUTH_REFUSALS.signedOut]: DOWNLOAD_MESSAGES.signInAgain,
  [AUTH_REFUSALS.pending]: DOWNLOAD_MESSAGES.waiting,
  [AUTH_REFUSALS.revoked]: DOWNLOAD_MESSAGES.removed,
  [AUTH_REFUSALS.notOwner]: DOWNLOAD_MESSAGES.removed,
} as const satisfies Record<AccountRefusal, string>

/** What a paused row says, by its reason; null for the viewer's own pause. */
export const PAUSED_MESSAGES = {
  [PAUSE_REASONS.viewer]: null,
  [PAUSE_REASONS.noSpace]: DOWNLOAD_MESSAGES.noSpace,
  [PAUSE_REASONS.relocked]: DOWNLOAD_MESSAGES.relocked,
  [PAUSE_REASONS.unreachable]: DOWNLOAD_MESSAGES.unreachable,
} as const satisfies Record<PauseReason, string | null>

/** What a failed row says, by its reason; `account` by why, and `other` says its own words. */
export const failedMessage = (failure: Failure): string => {
  switch (failure.reason) {
    case FAIL_REASONS.noSpace:
      return DOWNLOAD_MESSAGES.noSpace
    case FAIL_REASONS.changed:
      return DOWNLOAD_MESSAGES.changed
    case FAIL_REASONS.unreachable:
      return DOWNLOAD_MESSAGES.unreachable
    case FAIL_REASONS.gone:
      return EXPAND_MESSAGES.gone
    case FAIL_REASONS.account:
      return ACCOUNT_REFUSED_MESSAGES[failure.refusal]
    case FAIL_REASONS.other:
      return failure.message
    default: {
      const unreachable: never = failure
      return unreachable
    }
  }
}
