import type { MessageBoxOptions } from 'electron'
import { TRUST_MESSAGES, trustDetailFor } from '@/main/servers/serverTrust'

const ADD = 0
const CANCEL = 1

/**
 * main's own sheet asking whether to trust `origin`, so the page cannot fake the
 * consent. Cancel is the default and the escape, so Return or Escape adds nothing.
 */
export const trustPromptFor = ({ origin }: { origin: string }) =>
  ({
    type: 'question',
    message: TRUST_MESSAGES.prompt(origin),
    detail: trustDetailFor({ origin }),
    buttons: ['Add Server', 'Cancel'],
    defaultId: CANCEL,
    cancelId: CANCEL,
  }) satisfies MessageBoxOptions

export type TrustPrompt = ReturnType<typeof trustPromptFor>

/** Trust's `confirm` over a message box: a yes only when Add Server was chosen. */
export const confirmWith =
  ({ show }: { show: (prompt: TrustPrompt) => Promise<{ response: number }> }) =>
  async (origin: string): Promise<boolean> => {
    const { response } = await show(trustPromptFor({ origin }))
    return response === ADD
  }
