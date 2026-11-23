import { DESKTOP_REPLIES, type DesktopReply, PLAYER_SOURCE_KINDS } from '@raven/core'
import type { DownloadService } from '@/main/downloads/downloadService'
import { type AccountTickets, TICKET_OUTCOMES } from '@/main/servers/accountTickets'
import type { ServerInUse } from '@/main/servers/activeServer'
import { startRefusalOf } from '@/main/servers/serverSources'

type PlayProps = { mediaId: number; at: number; next: readonly number[] }

export type ServerTitles = {
  /**
   * What the native player needs to play a title of the server: a ready download of it as a
   * granted file, which plays with no server, else the server's title, once its first ticket
   * says the page's account may play it. `at` and `next` come back as the page sent them.
   */
  play: (input: PlayProps) => Promise<DesktopReply>
}

type TitleReplyProps = {
  source: Extract<DesktopReply, { type: typeof DESKTOP_REPLIES.title }>['source']
  at: number
  next: readonly number[]
}

const titleReply = ({ source, at, next }: TitleReplyProps): DesktopReply => ({
  type: DESKTOP_REPLIES.title,
  source,
  resumeAt: at,
  next: [...next],
})

type CreateServerTitlesProps = {
  /** The server in use, whose id the page's player names its titles by. */
  server: Pick<ServerInUse, 'current'>
  downloads: Pick<DownloadService, 'openTitle'>
  tickets: Pick<AccountTickets, 'ticketFor'>
}

/**
 * Server titles for the page's native player. Main mints the first ticket before it answers, so
 * a title the account may not play is refused with a reason before mpv opens anything, and the
 * load that follows plays on that same ticket.
 */
export const createServerTitles = ({
  server,
  downloads,
  tickets,
}: CreateServerTitlesProps): ServerTitles => {
  const play: ServerTitles['play'] = async ({ mediaId, at, next }) => {
    // Read first, so a switch while the ticket is minted names the server the title was asked of.
    const asked = server.current().id
    const fileId = await downloads.openTitle({ mediaId })
    if (fileId !== null) {
      return titleReply({ source: { kind: PLAYER_SOURCE_KINDS.file, fileId }, at, next })
    }
    const outcome = await tickets.ticketFor({ mediaId, isFresh: false })
    if (outcome.kind !== TICKET_OUTCOMES.ticket) {
      return { type: DESKTOP_REPLIES.titleRefused, ...startRefusalOf(outcome) }
    }
    return titleReply({
      source: { kind: PLAYER_SOURCE_KINDS.server, serverId: asked, mediaId },
      at,
      next,
    })
  }

  return { play }
}
