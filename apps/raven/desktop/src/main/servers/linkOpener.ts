import type { PlayRequest } from '@raven/core'
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
import type { DesktopReply } from '@/shared/protocol'

export const LINK_MESSAGES = {
  unreadable:
    'raven player could not read that link. It opens raven://play and raven://download links and raven watch pages.',
  downloadsSoon: 'raven player cannot download titles yet.',
} as const

const LINK_LOG_MAX = 100

export const replyForTrust = ({
  outcome,
  request,
}: {
  outcome: TrustOutcome
  request: PlayRequest
}): DesktopReply => {
  switch (outcome.kind) {
    case 'trusted':
      return {
        type: 'playServer',
        target: {
          serverId: outcome.server.id,
          mediaId: request.mediaId,
          at: request.at,
          next: request.next,
        },
      }
    case 'declined':
      return { type: 'done' }
    case 'full':
      return { type: 'refused', message: TRUST_MESSAGES.full }
    case 'busy':
      return { type: 'refused', message: TRUST_MESSAGES.busy }
    case 'unreachable':
      return { type: 'refused', message: TRUST_MESSAGES.unreachable(outcome.origin) }
    case 'invalid':
      return { type: 'refused', message: TRUST_MESSAGES.invalid }
    case 'unsaved':
      return { type: 'refused', message: TRUST_MESSAGES.unsaved }
    default: {
      const unreachable: never = outcome
      return unreachable
    }
  }
}

export type LinkOpener = {
  open: (input: { link: string; from: TrustSource }) => Promise<DesktopReply>
  openBatch: (links: readonly string[]) => Promise<DesktopReply>
}

/** Turns a `raven://play` link or a pasted watch page into a reply, asking trust about its server first. */
export const createLinkOpener = ({
  trust,
  warn,
}: {
  trust: Pick<ServerTrust, 'trust'>
  warn: (message: string) => void
}): LinkOpener => {
  const safeWarn = (message: string): void => {
    try {
      warn(message)
    } catch {
      // A throwing logger must not turn an answer into a rejection.
    }
  }

  const open: LinkOpener['open'] = async ({ link, from }) => {
    const request = readPlayLink(link)
    if (request === null) {
      if (readDownloadLink(link) !== null) {
        return { type: 'refused', message: LINK_MESSAGES.downloadsSoon }
      }
      safeWarn(`raven player could not read a link: ${loggable(link.slice(0, LINK_LOG_MAX))}`)
      return { type: 'refused', message: LINK_MESSAGES.unreadable }
    }
    const outcome = await Promise.resolve()
      .then(() => trust.trust({ origin: request.origin, from }))
      .catch((error: unknown): TrustOutcome => {
        safeWarn(`raven player could not trust ${request.origin}: ${loggable(messageOf(error))}`)
        return { kind: 'unsaved' }
      })
    return replyForTrust({ outcome, request })
  }

  return {
    open,
    openBatch: async (links) => {
      const [first, ...dropped] = links
      if (first === undefined) return { type: 'done' }
      // A page can fire links in a burst; acting on each would stack prompts or replace the video over and over.
      if (dropped.length > 0) {
        safeWarn(
          `raven player opened the first of ${links.length} links and dropped ${dropped.length}`,
        )
      }
      return open({ link: first, from: 'link' })
    },
  }
}
