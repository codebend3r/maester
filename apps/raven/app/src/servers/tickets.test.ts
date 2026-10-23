import { describe, expect, it } from 'bun:test'
import { ApiError, HOME_SHELF_TYPES, type Home, type MediaTicket } from '@raven/core'
import { mediaItemFor } from '@/test/mediaItem'

import { TICKET_SUPPORT, ticketSupportOf } from '@/servers/tickets'

const EMPTY_HOME: Home = { inProgress: [], shelves: [] }

const apiOf = ({
  home = EMPTY_HOME,
  ticket = async () => ({ ticket: 't', expiresAt: 1 }),
}: {
  home?: Home
  ticket?: (id: number) => Promise<MediaTicket>
}) => {
  const asked: number[] = []
  return {
    asked,
    api: {
      getHome: async () => home,
      getMediaTicket: async (id: number) => {
        asked.push(id)
        return ticket(id)
      },
    },
  }
}

const refusing = (status: number) => async (): Promise<MediaTicket> => {
  throw new ApiError({ status, message: 'no' })
}

describe('ticketSupportOf', () => {
  it('asks for a ticket for the first video in progress', async () => {
    const { api, asked } = apiOf({
      home: {
        inProgress: [{ media: mediaItemFor({ id: 7 }), poster: null }],
        shelves: [{ libraryId: 1, type: HOME_SHELF_TYPES.media, media: [mediaItemFor({ id: 9 })] }],
      },
    })
    expect(await ticketSupportOf({ api })).toBe(TICKET_SUPPORT.on)
    expect(asked).toEqual([7])
  })

  it("falls back to a shelf's first video", async () => {
    const { api, asked } = apiOf({
      home: {
        inProgress: [],
        shelves: [
          { libraryId: 1, type: HOME_SHELF_TYPES.shows, shows: [] },
          { libraryId: 2, type: HOME_SHELF_TYPES.media, media: [mediaItemFor({ id: 9 })] },
        ],
      },
    })
    expect(await ticketSupportOf({ api })).toBe(TICKET_SUPPORT.on)
    expect(asked).toEqual([9])
  })

  it('is off when the server answers 503', async () => {
    const { api } = apiOf({
      home: { inProgress: [{ media: mediaItemFor({ id: 7 }), poster: null }], shelves: [] },
      ticket: refusing(503),
    })
    expect(await ticketSupportOf({ api })).toBe(TICKET_SUPPORT.off)
  })

  it('is unknown for any other refusal', async () => {
    const { api } = apiOf({
      home: { inProgress: [{ media: mediaItemFor({ id: 7 }), poster: null }], shelves: [] },
      ticket: refusing(423),
    })
    expect(await ticketSupportOf({ api })).toBe(TICKET_SUPPORT.unknown)
  })

  it('is unknown with no video to ask about', async () => {
    const { api, asked } = apiOf({})
    expect(await ticketSupportOf({ api })).toBe(TICKET_SUPPORT.unknown)
    expect(asked).toEqual([])
  })

  it('is unknown when Home fails', async () => {
    const api = {
      getHome: async (): Promise<Home> => {
        throw new TypeError('Network request failed')
      },
      getMediaTicket: refusing(503),
    }
    expect(await ticketSupportOf({ api })).toBe(TICKET_SUPPORT.unknown)
  })
})
