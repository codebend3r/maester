import {
  DESKTOP_REPLIES,
  type DesktopEvent,
  type DesktopReply,
  type DesktopRequest,
  isDesktopEvent,
  isDesktopReply,
  type DesktopPlatform,
  type OpenReply,
  type RepliesFor,
  isOpenReply,
  isRavenDesktopBridge,
  isReplyTo,
} from '@raven/core'

/** The page's one door to main, with every reply and event checked on the way in. */
export type DesktopClient = {
  request: (request: DesktopRequest) => Promise<DesktopReply>
  dropFiles: (files: readonly File[]) => Promise<DesktopReply>
  subscribe: (listener: (event: DesktopEvent) => void) => () => void
  /** The system Raven runs on, which says who draws the window's controls and names the computer. */
  platform: DesktopPlatform
}

const UNREADABLE = {
  type: DESKTOP_REPLIES.refused,
  message: 'Raven could not read its own reply.',
} as const satisfies DesktopReply

/** Main's reply, or a refusal saying it could not be read; it never rejects. */
const replyOf = async (invoke: () => Promise<unknown>): Promise<DesktopReply> => {
  try {
    const reply = await invoke()
    return isDesktopReply(reply) ? reply : UNREADABLE
  } catch {
    return UNREADABLE
  }
}

type RefusalTextProps = {
  reply: DesktopReply
  fallback: string
}

/** What main said when it refused, else `fallback` for any other answer than the one asked for. */
export const refusalText = ({ reply, fallback }: RefusalTextProps): string =>
  reply.type === DESKTOP_REPLIES.refused ? reply.message : fallback

/** A client over the preload's bridge, or null where there is none: in a browser. */
export const clientFor = (bridge: unknown): DesktopClient | null => {
  if (!isRavenDesktopBridge(bridge)) return null
  return {
    platform: bridge.platform,
    request: (request) => replyOf(() => bridge.request(request)),
    dropFiles: (files) => replyOf(() => bridge.dropFiles(files)),
    subscribe: (listener) =>
      bridge.subscribe((event) => {
        if (!isDesktopEvent(event)) {
          console.warn('Raven ignored an event it does not understand.')
          return
        }
        listener(event)
      }),
  }
}

/** Main's refusal: what any request may get, its own or the page's for a reply it could not read. */
type Refusal = Extract<DesktopReply, { type: typeof DESKTOP_REPLIES.refused }>

type AskMainProps<R extends DesktopRequest> = {
  /** The page's client, or a host that speaks the same protocol for some of its requests. */
  client: { request: (request: R) => Promise<DesktopReply> }
  request: R
}

/**
 * Main's answer to `request`, of the kinds main gives it, so a caller handles only those; a
 * reply of any other kind reads as a refusal.
 */
export const askMain = async <R extends DesktopRequest>({
  client,
  request,
}: AskMainProps<R>): Promise<RepliesFor<R['type']> | Refusal> => {
  const reply = await client.request(request)
  const type: R['type'] = request.type
  return isReplyTo<R['type']>(type)(reply) ? reply : UNREADABLE
}

/** A reply main gives a request of `R`'s type, a refusal aside. */
type AnswerTo<R extends DesktopRequest> = Exclude<RepliesFor<R['type']>, Refusal>

const isAnswerTo =
  <R extends DesktopRequest>(request: R) =>
  (reply: DesktopReply): reply is AnswerTo<R> =>
    reply.type !== DESKTOP_REPLIES.refused && isReplyTo(request.type)(reply)

type ReadMainProps<R extends DesktopRequest> = AskMainProps<R> & {
  /** What the error says when main answered with another kind of reply than the one asked for. */
  fallback: string
}

/**
 * Main's answer to a read, for a query function: a refusal throws in main's words, and a reply
 * of another kind throws `fallback`.
 */
export const readMain = async <R extends DesktopRequest>({
  client,
  request,
  fallback,
}: ReadMainProps<R>): Promise<AnswerTo<R>> => {
  const reply = await client.request(request)
  if (isAnswerTo(request)(reply)) return reply
  throw new Error(refusalText({ reply, fallback }))
}

/** A reply to a way of opening something, as `useOpenReply` takes it; any other reads as a refusal. */
export const openReplyOf = (reply: DesktopReply): OpenReply | Refusal =>
  isOpenReply(reply) ? reply : UNREADABLE
