import { createAccountSession } from '@raven/native'

/** The secure-store key the signed-in account is kept under. */
const ACCOUNT_SESSION_KEY = 'raven.account'

/** Who is signed in to raven on this device; `AppRoot` hydrates it before any route. */
export const useAccountSession = createAccountSession({ storageKey: ACCOUNT_SESSION_KEY })
