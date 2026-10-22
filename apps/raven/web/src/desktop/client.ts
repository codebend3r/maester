import {
  DESKTOP_REPLIES,
  type DesktopEvent,
  type DesktopReply,
  type DesktopRequest,
  isDesktopEvent,
  isDesktopReply,
  isRavenDesktopBridge,
} from '@raven/core'

/** The page's one door to main, with every reply and event checked on the way in. */
export type DesktopClient = {
  request: (request: DesktopRequest) => Promise<DesktopReply>
  dropFiles: (files: readonly File[]) => Promise<DesktopReply>
  subscribe: (listener: (event: DesktopEvent) => void) => () => void
}

const UNREADABLE = {
  type: DESKTOP_REPLIES.refused,
  message: 'raven player could not read its own reply.',
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

/** What main said when it refused, else `fallback` for any other answer than the one asked for. */
export const refusalText = ({
  reply,
  fallback,
}: {
  reply: DesktopReply
  fallback: string
}): string => (reply.type === DESKTOP_REPLIES.refused ? reply.message : fallback)

/** A client over the preload's bridge, or null where there is none: in a browser. */
export const clientFor = (bridge: unknown): DesktopClient | null => {
  if (!isRavenDesktopBridge(bridge)) return null
  return {
    request: (request) => replyOf(() => bridge.request(request)),
    dropFiles: (files) => replyOf(() => bridge.dropFiles(files)),
    subscribe: (listener) =>
      bridge.subscribe((event) => {
        if (!isDesktopEvent(event)) {
          console.warn('raven player ignored an event it does not understand.')
          return
        }
        listener(event)
      }),
  }
}
