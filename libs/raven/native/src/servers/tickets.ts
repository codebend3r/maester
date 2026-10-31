import { ApiError, type ApiClient, HOME_SHELF_TYPES, type Home } from '@raven/core'

/** Whether a server hands out media tickets: `off` is the 503 a server without `RAVEN_MEDIA_SECRET` answers. */
export const TICKET_SUPPORT = { on: 'on', off: 'off', unknown: 'unknown' } as const

type TicketSupport = (typeof TICKET_SUPPORT)[keyof typeof TICKET_SUPPORT]

/** What the ticket route answers on a server without `RAVEN_MEDIA_SECRET`. */
export const TICKETS_OFF_STATUS = 503

const firstMediaIdOf = (home: Home): number | null => {
  const shelved = home.shelves.flatMap((shelf) =>
    shelf.type === HOME_SHELF_TYPES.media ? shelf.media : [],
  )
  return home.inProgress[0]?.media.id ?? shelved[0]?.id ?? null
}

type TicketSupportOfProps = {
  api: Pick<ApiClient, 'getHome' | 'getMediaTicket'>
}

/**
 * Asks for a ticket for any video on Home, to learn whether the server hands them out.
 * Anything but a ticket or a 503 (a locked library's 423, no video at all, a network
 * failure) says nothing either way.
 */
export const ticketSupportOf = async ({ api }: TicketSupportOfProps): Promise<TicketSupport> => {
  try {
    const id = firstMediaIdOf(await api.getHome())
    if (id === null) return TICKET_SUPPORT.unknown
    await api.getMediaTicket(id)
    return TICKET_SUPPORT.on
  } catch (error) {
    const isOff = error instanceof ApiError && error.status === TICKETS_OFF_STATUS
    return isOff ? TICKET_SUPPORT.off : TICKET_SUPPORT.unknown
  }
}
