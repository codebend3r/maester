import type { PlayRequest } from '@raven/core'
import type { DownloadService } from '@/main/downloads/downloadService'
import { loggable } from '@/main/servers/serverCalls'
import { TRUST_MESSAGES, type ServerTrust, type TrustOutcome } from '@/main/servers/serverTrust'
import { messageOf } from '@/shared/messageOf'
import { readDownloadLink, readPlayLink } from '@/shared/playLink'
import type { DesktopReply } from '@/shared/protocol'

export const LINK_MESSAGES = {
  unreadable:
    'raven player could not read that link. It opens raven://play and raven://download links and raven watch pages.',
} as const

const LINK_LOG_MAX = 100

/** What a link answers when trust kept no server for it: nothing after a no, else why not. */
const replyForUntrusted = (outcome: Exclude<TrustOutcome, { kind: 'trusted' }>): DesktopReply => {
  switch (outcome.kind) {
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

export const replyForTrust = ({
  outcome,
  request,
}: {
  outcome: TrustOutcome
  request: PlayRequest
}): DesktopReply =>
  outcome.kind === 'trusted'
    ? {
        type: 'playServer',
        target: {
          serverId: outcome.server.id,
          mediaId: request.mediaId,
          at: request.at,
          next: request.next,
        },
      }
    : replyForUntrusted(outcome)

export type LinkOpener = {
  open: (input: { link: string; from: 'link' | 'app' }) => Promise<DesktopReply>
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
  const safeWarn = (message: string): void => {
    try {
      warn(message)
    } catch {
      // A throwing logger must not turn an answer into a rejection.
    }
  }

  const askTrust = ({
    origin,
    from,
  }: {
    origin: string
    from: 'link' | 'app'
  }): Promise<TrustOutcome> =>
    Promise.resolve()
      .then(() => trust.trust({ origin, from }))
      .catch((error: unknown): TrustOutcome => {
        safeWarn(`raven player could not trust ${origin}: ${loggable(messageOf(error))}`)
        return { kind: 'unsaved' }
      })

  const open: LinkOpener['open'] = async ({ link, from }) => {
    const request = readPlayLink(link)
    if (request !== null) {
      return replyForTrust({ outcome: await askTrust({ origin: request.origin, from }), request })
    }
    const download = readDownloadLink(link)
    if (download !== null) {
      const outcome = await askTrust({ origin: download.origin, from })
      if (outcome.kind !== 'trusted') return replyForUntrusted(outcome)
      return downloads.ask({ serverId: outcome.server.id, target: download.target })
    }
    safeWarn(`raven player could not read a link: ${loggable(link.slice(0, LINK_LOG_MAX))}`)
    return { type: 'refused', message: LINK_MESSAGES.unreadable }
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
