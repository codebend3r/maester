import {
  AUTH_REFUSALS,
  DESKTOP_REPLIES,
  isDesktopReply,
  PLAYER_SOURCE_KINDS,
  TITLE_REFUSALS,
} from '@raven/core'
import { describe, expect, it } from 'bun:test'
import type { ServerEntry } from '@/main/desktopConfig'
import { TICKET_OUTCOMES, type TicketOutcome } from '@/main/servers/accountTickets'
import { SOURCE_MESSAGES } from '@/main/servers/serverSources'
import { createServerTitles } from '@/main/servers/serverTitles'

const SERVER: ServerEntry = {
  id: '00000000-0000-4000-8000-000000000001',
  origin: 'https://raven.example',
  name: 'raven',
}
const FILE_ID = '20000000-0000-4000-8000-000000000001'
const TICKET: TicketOutcome = { kind: TICKET_OUTCOMES.ticket, ticket: 'account.t1' }

const setup = ({
  download = null,
  ticket = TICKET,
}: {
  download?: string | null
  ticket?: TicketOutcome
} = {}) => {
  const opened: { serverId: string; mediaId: number }[] = []
  const minted: { serverId: string; mediaId: number; isFresh: boolean }[] = []
  const titles = createServerTitles({
    server: () => SERVER,
    downloads: {
      openTitle: async (input) => {
        opened.push(input)
        return download
      },
    },
    tickets: {
      ticketFor: async (input) => {
        minted.push(input)
        return ticket
      },
    },
  })
  return { titles, opened, minted }
}

describe('play', () => {
  it('plays a ready download of the title as a file, and mints nothing', async () => {
    const { titles, opened, minted } = setup({ download: FILE_ID })
    const reply = await titles.play({ mediaId: 7, at: 30, next: [8] })
    expect(reply).toEqual({
      type: DESKTOP_REPLIES.title,
      source: { kind: PLAYER_SOURCE_KINDS.file, fileId: FILE_ID },
      resumeAt: 30,
      next: [8],
    })
    expect(isDesktopReply(reply)).toBe(true)
    expect(opened).toEqual([{ serverId: SERVER.id, mediaId: 7 }])
    expect(minted).toEqual([])
  })

  it("plays the server's title once its first ticket is minted", async () => {
    const { titles, minted } = setup()
    expect(await titles.play({ mediaId: 7, at: 0, next: [] })).toEqual({
      type: DESKTOP_REPLIES.title,
      source: { kind: PLAYER_SOURCE_KINDS.server, serverId: SERVER.id, mediaId: 7 },
      resumeAt: 0,
      next: [],
    })
    expect(minted).toEqual([{ serverId: SERVER.id, mediaId: 7, isFresh: false }])
  })

  it.each([
    [
      'signed out',
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.signedOut },
      TITLE_REFUSALS.signedOut,
      SOURCE_MESSAGES.signIn('raven'),
    ],
    [
      'waiting for approval',
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.pending },
      TITLE_REFUSALS.denied,
      SOURCE_MESSAGES.pending('raven'),
    ],
    [
      'removed',
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.revoked },
      TITLE_REFUSALS.denied,
      SOURCE_MESSAGES.removed('raven'),
    ],
    [
      'not the owner',
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.notOwner },
      TITLE_REFUSALS.denied,
      SOURCE_MESSAGES.removed('raven'),
    ],
    [
      'with accounts down',
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.unavailable },
      TITLE_REFUSALS.unreachable,
      SOURCE_MESSAGES.lost('raven'),
    ],
    [
      'locked',
      { kind: TICKET_OUTCOMES.locked },
      TITLE_REFUSALS.locked,
      SOURCE_MESSAGES.relocked('raven'),
    ],
    ['gone', { kind: TICKET_OUTCOMES.gone }, TITLE_REFUSALS.gone, SOURCE_MESSAGES.gone('raven')],
    [
      'out of reach',
      { kind: TICKET_OUTCOMES.unreachable },
      TITLE_REFUSALS.unreachable,
      SOURCE_MESSAGES.lost('raven'),
    ],
  ] as const)(
    'refuses a title %s with a reason the page acts on',
    async (_name, ticket, reason, message) => {
      const { titles } = setup({ ticket })
      const reply = await titles.play({ mediaId: 7, at: 0, next: [] })
      expect(reply).toEqual({ type: DESKTOP_REPLIES.titleRefused, reason, message })
      expect(isDesktopReply(reply)).toBe(true)
    },
  )
})
