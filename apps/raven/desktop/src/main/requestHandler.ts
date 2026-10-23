import { DESKTOP_REPLIES, type DesktopReply, PAGE_ORIGIN } from '@raven/core'
import { MESSAGES } from '@/main/desktopService'
import { errorText, isFsError } from '@/main/log/errorText'

const REFUSED = {
  type: DESKTOP_REPLIES.refused,
  message: MESSAGES.unknownRequest,
} as const satisfies DesktopReply

// A file system error's message, and so its stack, names a path the log must not hold.
const describeError = (error: unknown): string =>
  error instanceof Error && !isFsError(error) ? (error.stack ?? error.message) : errorText(error)

/**
 * The request channel's door: only the page's own frame is answered, every refusal
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
      warn(`Raven refused a request from ${frameUrl ?? 'an unknown frame'}, not ${PAGE_ORIGIN}.`)
      return REFUSED
    }
    try {
      const reply = await handle(payload)
      if (reply.type === DESKTOP_REPLIES.refused) {
        warn(`Raven refused a request: ${reply.message}`)
      }
      return reply
    } catch (error) {
      warn(`Raven failed to answer a request: ${describeError(error)}`)
      return REFUSED
    }
  }
}
