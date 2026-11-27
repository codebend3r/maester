import { IGNORED, forgetOnAccountChange } from '@raven/native/headless'
import { createQueryClient } from '@raven/ui/headless'

import { forgetSongProgressOnAccountChange, useWrenAccount } from '@raven/wren-native'

/** Wren on TV's one cache: it talks to one server. */
export const queryClient = createQueryClient()

/**
 * Forgets the last account's answers and queue on every change of account, so its music stops
 * rather than counting its listens under the next one's token, and each song's progress on the
 * TV once an account signed in signs out or gives way to another. Hands back the way to stop.
 */
export const forgetWrenAccount = (): (() => void) => {
  // A TV keeps no downloads, so nothing else of the account's is let go of.
  const stopForgetting = forgetOnAccountChange({
    session: useWrenAccount,
    cache: queryClient,
    alsoForget: IGNORED,
  })
  const stopProgress = forgetSongProgressOnAccountChange({ session: useWrenAccount })
  return () => {
    stopForgetting()
    stopProgress()
  }
}
