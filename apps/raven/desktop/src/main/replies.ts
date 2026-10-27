import { DESKTOP_REPLIES, type DesktopReply } from '@raven/core'

/** The reply to a request that changed something and has nothing to say back. */
export const DONE = { type: DESKTOP_REPLIES.done } as const satisfies DesktopReply

/** The reply to a request main would not act on, with the words the page shows. */
export const refused = (message: string): DesktopReply => ({
  type: DESKTOP_REPLIES.refused,
  message,
})
