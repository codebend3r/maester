import type { MessageBoxOptions } from 'electron'
import { TRUST_MESSAGES, trustDetailFor, withLookalikeNote } from '@/main/servers/serverTrust'

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

/**
 * main's own sheet asking whether to follow a server whose sign-in moved to another host.
 * Cancel is the default and the escape, so Return or Escape keeps the old pin.
 */
export const signInChangePromptFor = ({ serverName, host }: { serverName: string; host: string }) =>
  ({
    type: 'question',
    message: TRUST_MESSAGES.signInChanged({ serverName, host }),
    detail: withLookalikeNote({
      detail: TRUST_MESSAGES.signInChangedDetail,
      origin: `https://${host}`,
    }),
    buttons: ['Use It', 'Cancel'],
    defaultId: CANCEL,
    cancelId: CANCEL,
  }) satisfies MessageBoxOptions

export type SignInChangePrompt = ReturnType<typeof signInChangePromptFor>

/** A changed sign-in's `confirm` over a message box: a yes only when Use It was chosen. */
export const confirmSignInChangeWith =
  ({ show }: { show: (prompt: SignInChangePrompt) => Promise<{ response: number }> }) =>
  async (input: { serverName: string; host: string }): Promise<boolean> => {
    const { response } = await show(signInChangePromptFor(input))
    return response === ADD
  }
