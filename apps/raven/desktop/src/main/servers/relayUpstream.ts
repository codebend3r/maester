import { HTTP_METHODS } from '@raven/core'
import { TICKET_OUTCOMES, type TicketOutcome } from '@/main/servers/accountTickets'

/** The only methods the relay forwards. */
export const RELAY_METHODS = { get: HTTP_METHODS.get, head: HTTP_METHODS.head } as const
export type RelayMethod = (typeof RELAY_METHODS)[keyof typeof RELAY_METHODS]

export const isRelayMethod = (method: string | undefined): method is RelayMethod =>
  method === RELAY_METHODS.get || method === RELAY_METHODS.head

type UpstreamFetchProps = {
  url: string
  method: RelayMethod
  headers: Record<string, string>
  signal: AbortSignal
}

/**
 * Main's `net.fetch` for a relayed request: no cookie, no redirect followed, nothing cached.
 * The signal aborts the fetch and its body as mpv lets go of the request.
 */
export type UpstreamFetch = (input: UpstreamFetchProps) => Promise<{
  status: number
  headers: { get: (name: string) => string | null }
  body: ReadableStream<Uint8Array> | null
}>

export type Upstream = Awaited<ReturnType<UpstreamFetch>>

/** A request of the relay's, its path taken from the load's origins as they stand. */
export type RelayRequest = Omit<UpstreamFetchProps, 'url'> & { path: string }

export type TicketFailure = Exclude<TicketOutcome, { kind: typeof TICKET_OUTCOMES.ticket }>

/** What the relay fetched for a request: the upstream's answer, or why no ticket was minted. */
export type Fetched = { kind: typeof TICKET_OUTCOMES.ticket; upstream: Upstream } | TicketFailure

/** Lets go of an answer's body unread. */
export const discard = async (upstream: Upstream): Promise<void> => {
  if (upstream.body === null) return
  await upstream.body.cancel().catch(() => undefined)
}
