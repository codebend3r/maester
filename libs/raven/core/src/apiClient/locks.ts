import type { Transport } from '@/apiClient/transport'
import {
  type AdminLock,
  type AdminUnlockRequest,
  isAdminLock,
  isLockState,
  type LockState,
  type UnlockRequest,
} from '@/contract'

/** The PIN lock on the locked libraries, and the admin lock on managing. */
export const lockCalls = ({ send, expect }: Transport) => ({
  getLock: (): Promise<LockState> =>
    expect({ request: send({ path: '/api/lock' }), guard: isLockState }),

  /** Opens every locked library for this browser; a wrong PIN fails with the server's reason. */
  unlock: (pin: string): Promise<LockState> =>
    expect({
      request: send({
        path: '/api/lock/unlock',
        method: 'POST',
        body: { pin } satisfies UnlockRequest,
      }),
      guard: isLockState,
    }),

  /** Closes the locked libraries again. */
  lock: (): Promise<LockState> =>
    expect({ request: send({ path: '/api/lock/lock', method: 'POST' }), guard: isLockState }),

  getAdminLock: (): Promise<AdminLock> =>
    expect({ request: send({ path: '/api/admin' }), guard: isAdminLock }),

  /** Turns the admin lock off in this browser; a wrong password fails with the server's reason. */
  unlockAdmin: (password: string): Promise<AdminLock> =>
    expect({
      request: send({
        path: '/api/admin/unlock',
        method: 'POST',
        body: { password } satisfies AdminUnlockRequest,
      }),
      guard: isAdminLock,
    }),

  /** Turns the admin lock back on, after a short wait in which `keepAdminUnlocked` undoes it. */
  lockAdmin: (): Promise<AdminLock> =>
    expect({ request: send({ path: '/api/admin/lock', method: 'POST' }), guard: isAdminLock }),

  /** Takes back a `lockAdmin` that has yet to hold, with no password; fails once it holds. */
  keepAdminUnlocked: (): Promise<AdminLock> =>
    expect({
      request: send({ path: '/api/admin/keep-unlocked', method: 'POST' }),
      guard: isAdminLock,
    }),
})
