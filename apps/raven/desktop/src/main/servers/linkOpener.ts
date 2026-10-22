import { DESKTOP_REPLIES, type DesktopReply, watchPathFor } from '@raven/core'
import type { DownloadService } from '@/main/downloads/downloadService'
import { quietly } from '@/main/log/quietly'
import { loggable } from '@/main/servers/serverCalls'
import { readDownloadLink, readPlayLink } from '@/shared/playLink'

export const LINK_MESSAGES = {
  unreadable:
    'raven player could not read that link. It opens raven://play and raven://download links and raven watch pages.',
  otherServer: 'raven player opens links to its own server only.',
} as const

const LINK_LOG_MAX = 100

export type LinkOpener = {
  /** A link the page was given (File > Open Link). */
  open: (input: { link: string }) => Promise<DesktopReply>
  /** A batch of links main was handed (`open-url`); the opener acts on the first. */
  openBatch: (links: readonly string[]) => Promise<DesktopReply>
}

/**
 * Turns a `raven://play` link or a pasted watch page into the web's watch page, and a
 * `raven://download` link into a download ask, for links that name the one server, by its
 * origin or an alias. Any other server's link is refused: there is nothing to ask about it.
 */
export const createLinkOpener = ({
  isServerOrigin,
  serverId,
  downloads,
  warn,
}: {
  /** Whether a link's `server` names the one server. */
  isServerOrigin: (origin: string) => boolean
  /** The one server's id, read at each link. */
  serverId: () => string
  downloads: Pick<DownloadService, 'ask'>
  warn: (message: string) => void
}): LinkOpener => {
  const safeWarn = quietly(warn)

  const otherServer = (): DesktopReply => {
    safeWarn('raven player refused a link to another server')
    return { type: DESKTOP_REPLIES.refused, message: LINK_MESSAGES.otherServer }
  }

  const open: LinkOpener['open'] = async ({ link }) => {
    const request = readPlayLink(link)
    if (request !== null) {
      if (!isServerOrigin(request.origin)) return otherServer()
      return { type: DESKTOP_REPLIES.navigate, to: watchPathFor(request) }
    }
    const download = readDownloadLink(link)
    if (download !== null) {
      if (!isServerOrigin(download.origin)) return otherServer()
      return downloads.ask({ serverId: serverId(), target: download.target })
    }
    safeWarn(`raven player could not read a link: ${loggable(link.slice(0, LINK_LOG_MAX))}`)
    return { type: DESKTOP_REPLIES.refused, message: LINK_MESSAGES.unreadable }
  }

  return {
    open,
    openBatch: async (links) => {
      const [first, ...dropped] = links
      if (first === undefined) return { type: DESKTOP_REPLIES.done }
      // A page can fire links in a burst; acting on each would stack asks or move the page over and over.
      if (dropped.length > 0) {
        safeWarn(
          `raven player opened the first of ${links.length} links and dropped ${dropped.length}`,
        )
      }
      return open({ link: first })
    },
  }
}
