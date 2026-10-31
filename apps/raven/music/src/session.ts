import { createAccountSession } from '@raven/native'

/** The secure-store key the signed-in account is kept under. */
const ACCOUNT_SESSION_KEY = 'wren.account'

/** Who is signed in to raven in Wren; `WrenRoot` hydrates it before any route. */
export const useWrenAccount = createAccountSession({ storageKey: ACCOUNT_SESSION_KEY })
