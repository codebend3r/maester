import type { RavenDesktopBridge } from '@/shared/bridge'
import {
  type DesktopEvent,
  type DesktopReply,
  type DesktopRequest,
  isDesktopEvent,
  isDesktopReply,
} from '@/shared/protocol'

export type DesktopClient = {
  request: (request: DesktopRequest) => Promise<DesktopReply>
  dropFiles: (files: readonly File[]) => Promise<DesktopReply>
  subscribe: (listener: (event: DesktopEvent) => void) => () => void
}

const UNREADABLE = {
  type: 'refused',
  message: 'raven player could not read its own reply.',
} as const satisfies DesktopReply

const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === 'function'

export const isRavenDesktopBridge = (value: unknown): value is RavenDesktopBridge =>
  typeof value === 'object' &&
  value !== null &&
  'request' in value &&
  isFunction(value.request) &&
  'dropFiles' in value &&
  isFunction(value.dropFiles) &&
  'subscribe' in value &&
  isFunction(value.subscribe)

const replyOf = async (invoke: () => Promise<unknown>): Promise<DesktopReply> => {
  try {
    const reply = await invoke()
    return isDesktopReply(reply) ? reply : UNREADABLE
  } catch {
    return UNREADABLE
  }
}

/** The page's one door to main, with every reply and event checked on the way in. */
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
