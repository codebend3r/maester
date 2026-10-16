import { MESSAGES } from '@/main/desktopService'
import { APP_ORIGIN, type DesktopReply } from '@/shared/protocol'

const REFUSED = {
  type: 'refused',
  message: MESSAGES.unknownRequest,
} as const satisfies DesktopReply

const describeError = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error)

/**
 * The request channel's door: only the app's own frame is answered, every refusal
 * is logged, and a failing service is answered with a refusal instead of a rejection.
 */
export const createRequestHandler = ({
  isTrustedSender,
  handle,
  warn,
}: {
  isTrustedSender: (frameUrl: string | null) => boolean
  handle: (envelope: unknown) => Promise<DesktopReply>
  warn: (message: string) => void
}): ((request: { frameUrl: string | null; payload: unknown }) => Promise<DesktopReply>) => {
  return async ({ frameUrl, payload }) => {
    if (!isTrustedSender(frameUrl)) {
      warn(
        `raven player refused a request from ${frameUrl ?? 'an unknown frame'}, not ${APP_ORIGIN}.`,
      )
      return REFUSED
    }
    try {
      const reply = await handle(payload)
      if (reply.type === 'refused') warn(`raven player refused a request: ${reply.message}`)
      return reply
    } catch (error) {
      warn(`raven player failed to answer a request: ${describeError(error)}`)
      return REFUSED
    }
  }
}
