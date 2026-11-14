import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import {
  type AdminLock,
  type AdminUnlockRequest,
  type LockState,
  type UnlockRequest,
} from '@/contract'

/** The PIN lock on the locked libraries, and the admin lock on managing. */
export const lockCalls = ({ ask }: Transport) => ({
  getLock: (): Promise<LockState> => ask({ route: ROUTES.getLock }),

  /** Opens every locked library for this browser; a wrong PIN fails with the server's reason. */
  unlock: (pin: string): Promise<LockState> =>
    ask({ route: ROUTES.unlock, body: { pin } satisfies UnlockRequest }),

  /** Closes the locked libraries again. */
  lock: (): Promise<LockState> => ask({ route: ROUTES.lock }),

  getAdminLock: (): Promise<AdminLock> => ask({ route: ROUTES.getAdminLock }),

  /** Turns the admin lock off in this browser; a wrong password fails with the server's reason. */
  unlockAdmin: (password: string): Promise<AdminLock> =>
    ask({ route: ROUTES.unlockAdmin, body: { password } satisfies AdminUnlockRequest }),

  /** Turns the admin lock back on, after a short wait in which `keepAdminUnlocked` undoes it. */
  lockAdmin: (): Promise<AdminLock> => ask({ route: ROUTES.lockAdmin }),

  /** Takes back a `lockAdmin` that has yet to hold, with no password; fails once it holds. */
  keepAdminUnlocked: (): Promise<AdminLock> => ask({ route: ROUTES.keepAdminUnlocked }),
})
