import { type Infer, isBoolean, isNumber, isString, object, oneOf, union } from '@/schema'

/**
 * Whether locked libraries can be opened here: `available` once the server
 * has a PIN, `unlocked` once this browser has entered it.
 */
export const isLockState = object({
  available: isBoolean,
  unlocked: isBoolean,
})

export type LockState = Infer<typeof isLockState>

export const ADMIN_LOCK_STATES = { on: 'on', turningOn: 'turningOn', off: 'off' } as const

/**
 * The admin lock, as it stands for this browser. It is on until the admin
 * password is entered here, and while it is, locked libraries are left out
 * altogether, no video can be deleted, and no file's path is handed out.
 * `available` once the server has a strong `ADMIN_PASSWORD`, so it can be
 * turned off. Turned back on, it waits `remainingMs` (counted from this
 * answer) before it holds, and until then it goes off again with no password.
 */
export const isAdminLock = union(
  object({ state: oneOf([ADMIN_LOCK_STATES.on]), available: isBoolean }),
  object({ state: oneOf([ADMIN_LOCK_STATES.turningOn]), remainingMs: isNumber }),
  object({ state: oneOf([ADMIN_LOCK_STATES.off]) }),
)

export type AdminLock = Infer<typeof isAdminLock>

/** `POST /api/lock/unlock`: the PIN that opens every locked library. */
export const isUnlockRequest = object({
  pin: isString,
})

export type UnlockRequest = Infer<typeof isUnlockRequest>

/** `POST /api/admin/unlock`: the admin password, which turns the admin lock off in this browser. */
export const isAdminUnlockRequest = object({
  password: isString,
})

export type AdminUnlockRequest = Infer<typeof isAdminUnlockRequest>
