import { IGNORED, forgetOnAccountChange } from '@raven/native/headless'
import { createQueryClient } from '@raven/ui/headless'

import { useWrenAccount } from '@raven/wren-native'

/** Wren on TV's one cache: it talks to one server. */
export const queryClient = createQueryClient()

/**
 * Forgets the last account's answers and queue on every change of account, so its music stops
 * rather than counting its listens under the next one's token. Hands back the way to stop.
 */
export const forgetWrenAccount = (): (() => void) =>
  // A TV keeps no downloads, so nothing else of the account's is let go of.
  forgetOnAccountChange({ session: useWrenAccount, cache: queryClient, alsoForget: IGNORED })
