import type { PlayRequest } from '@raven/core'
import type { DownloadService } from '@/main/downloads/downloadService'
import { quietly } from '@/main/log/quietly'
import { loggable } from '@/main/servers/serverCalls'
import {
  TRUST_MESSAGES,
  TRUST_OUTCOME_KINDS,
  TRUST_SOURCES,
  type ServerTrust,
  type TrustOutcome,
  type TrustSource,
} from '@/main/servers/serverTrust'
import { messageOf } from '@/shared/messageOf'
import { readDownloadLink, readPlayLink } from '@/shared/playLink'
import { DESKTOP_REPLIES, type DesktopReply } from '@/shared/protocol'

export const LINK_MESSAGES = {
  unreadable:
    'raven player could not read that link. It opens raven://play and raven://download links and raven watch pages.',
} as const

const LINK_LOG_MAX = 100

/** What a link answers when trust kept no server for it: nothing after a no, else why not. */
const replyForUntrusted = (
  outcome: Exclude<TrustOutcome, { kind: typeof TRUST_OUTCOME_KINDS.trusted }>,
): DesktopReply => {
  switch (outcome.kind) {
    case TRUST_OUTCOME_KINDS.declined:
      return { type: DESKTOP_REPLIES.done }
    case TRUST_OUTCOME_KINDS.full:
      return { type: DESKTOP_REPLIES.refused, message: TRUST_MESSAGES.full }
    case TRUST_OUTCOME_KINDS.busy:
      return { type: DESKTOP_REPLIES.refused, message: TRUST_MESSAGES.busy }
    case TRUST_OUTCOME_KINDS.unreachable:
      return { type: DESKTOP_REPLIES.refused, message: TRUST_MESSAGES.unreachable(outcome.origin) }
    case TRUST_OUTCOME_KINDS.badSignIn:
      return { type: DESKTOP_REPLIES.refused, message: TRUST_MESSAGES.badSignIn }
    case TRUST_OUTCOME_KINDS.invalid:
      return { type: DESKTOP_REPLIES.refused, message: TRUST_MESSAGES.invalid }
    case TRUST_OUTCOME_KINDS.unsaved:
      return { type: DESKTOP_REPLIES.refused, message: TRUST_MESSAGES.unsaved }
    default: {
      const unreachable: never = outcome
      return unreachable
    }
  }
}

export const replyForTrust = ({
  outcome,
  request,
}: {
  outcome: TrustOutcome
  request: PlayRequest
}): DesktopReply =>
  outcome.kind === TRUST_OUTCOME_KINDS.trusted
    ? {
        type: DESKTOP_REPLIES.playServer,
        target: {
          serverId: outcome.server.id,
          mediaId: request.mediaId,
          at: request.at,
          next: request.next,
        },
      }
    : replyForUntrusted(outcome)

export type LinkOpener = {
  open: (input: { link: string; from: TrustSource }) => Promise<DesktopReply>
  openBatch: (links: readonly string[]) => Promise<DesktopReply>
}

/**
 * Turns a `raven://play` link, a pasted watch page or a `raven://download` link into a reply,
 * asking trust about its server first.
 */
export const createLinkOpener = ({
  trust,
  downloads,
  warn,
}: {
  trust: Pick<ServerTrust, 'trust'>
  downloads: Pick<DownloadService, 'ask'>
  warn: (message: string) => void
}): LinkOpener => {
  const safeWarn = quietly(warn)

  const askTrust = ({
    origin,
    from,
  }: {
    origin: string
    from: TrustSource
  }): Promise<TrustOutcome> =>
    Promise.resolve()
      .then(() => trust.trust({ origin, from }))
      .catch((error: unknown): TrustOutcome => {
        safeWarn(`raven player could not trust ${origin}: ${loggable(messageOf(error))}`)
        return { kind: TRUST_OUTCOME_KINDS.unsaved }
      })

  const open: LinkOpener['open'] = async ({ link, from }) => {
    const request = readPlayLink(link)
    if (request !== null) {
      return replyForTrust({ outcome: await askTrust({ origin: request.origin, from }), request })
    }
    const download = readDownloadLink(link)
    if (download !== null) {
      const outcome = await askTrust({ origin: download.origin, from })
      if (outcome.kind !== TRUST_OUTCOME_KINDS.trusted) return replyForUntrusted(outcome)
      return downloads.ask({ serverId: outcome.server.id, target: download.target })
    }
    safeWarn(`raven player could not read a link: ${loggable(link.slice(0, LINK_LOG_MAX))}`)
    return { type: DESKTOP_REPLIES.refused, message: LINK_MESSAGES.unreadable }
  }

  return {
    open,
    openBatch: async (links) => {
      const [first, ...dropped] = links
      if (first === undefined) return { type: DESKTOP_REPLIES.done }
      // A page can fire links in a burst; acting on each would stack prompts or replace the video over and over.
      if (dropped.length > 0) {
        safeWarn(
          `raven player opened the first of ${links.length} links and dropped ${dropped.length}`,
        )
      }
      return open({ link: first, from: TRUST_SOURCES.link })
    },
  }
}
