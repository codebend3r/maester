import { DESKTOP_REPLIES, type DesktopReply, PLAYER_SOURCE_KINDS } from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import type { DownloadService } from '@/main/downloads/downloadService'
import { type AccountTickets, TICKET_OUTCOMES } from '@/main/servers/accountTickets'
import { startRefusalOf } from '@/main/servers/serverSources'

export type ServerTitles = {
  /**
   * What the native player needs to play a title of the server: a ready download of it as a
   * granted file, which plays with no server, else the server's title, once its first ticket
   * says the page's account may play it. `at` and `next` come back as the page sent them.
   */
  play: (input: { mediaId: number; at: number; next: readonly number[] }) => Promise<DesktopReply>
}

const titleReply = ({
  source,
  at,
  next,
}: {
  source: Extract<DesktopReply, { type: typeof DESKTOP_REPLIES.title }>['source']
  at: number
  next: readonly number[]
}): DesktopReply => ({ type: DESKTOP_REPLIES.title, source, resumeAt: at, next: [...next] })

/**
 * Server titles for the page's native player. Main mints the first ticket before it answers, so
 * a title the account may not play is refused with a reason before mpv opens anything, and the
 * load that follows plays on that same ticket.
 */
export const createServerTitles = ({
  server,
  downloads,
  tickets,
}: {
  /** The one server, read at each call. */
  server: () => ServerEntry
  downloads: Pick<DownloadService, 'openTitle'>
  tickets: Pick<AccountTickets, 'ticketFor'>
}): ServerTitles => {
  const play: ServerTitles['play'] = async ({ mediaId, at, next }) => {
    const { id: serverId, name } = server()
    const fileId = await downloads.openTitle({ serverId, mediaId })
    if (fileId !== null) {
      return titleReply({ source: { kind: PLAYER_SOURCE_KINDS.file, fileId }, at, next })
    }
    const outcome = await tickets.ticketFor({ serverId, mediaId, isFresh: false })
    if (outcome.kind !== TICKET_OUTCOMES.ticket) {
      return { type: DESKTOP_REPLIES.titleRefused, ...startRefusalOf({ outcome, name }) }
    }
    return titleReply({ source: { kind: PLAYER_SOURCE_KINDS.server, serverId, mediaId }, at, next })
  }

  return { play }
}
