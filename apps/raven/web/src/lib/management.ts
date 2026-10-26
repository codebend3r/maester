import type { AdminLock } from '@raven/core'
import { ACCESS_KINDS, type AccessState, useAccessState } from '@/lib/accessState'
import { isAdminLocked, useAdminLock } from '@/lib/adminLock'

export const MANAGEMENT_MODES = {
  adminLock: 'adminLock',
  owner: 'owner',
  none: 'none',
} as const

/** Who decides whether this browser may manage raven: the admin lock, the owner, or nobody yet. */
export type ManagementMode = (typeof MANAGEMENT_MODES)[keyof typeof MANAGEMENT_MODES]

type ManagementOfProps = {
  access: AccessState
  adminLock: AdminLock | undefined
}

/**
 * How raven is managed from where the viewer stands. Accounts off keeps the
 * admin lock; an approved account manages only as the owner; anything else,
 * including accounts that cannot be reached, manages nothing.
 */
export const managementOf = ({
  access,
  adminLock,
}: ManagementOfProps): { mode: ManagementMode; canManage: boolean } => {
  switch (access.kind) {
    case ACCESS_KINDS.disabled:
      return { mode: MANAGEMENT_MODES.adminLock, canManage: !isAdminLocked(adminLock) }
    case ACCESS_KINDS.approved:
      return { mode: MANAGEMENT_MODES.owner, canManage: access.account.isOwner }
    case ACCESS_KINDS.unavailable:
    case ACCESS_KINDS.loading:
    case ACCESS_KINDS.signedOut:
    case ACCESS_KINDS.failed:
    case ACCESS_KINDS.pending:
    case ACCESS_KINDS.revoked:
      return { mode: MANAGEMENT_MODES.none, canManage: false }
    default: {
      const unreachable: never = access
      return unreachable
    }
  }
}

export const useManagement = (): ReturnType<typeof managementOf> =>
  managementOf({ access: useAccessState(), adminLock: useAdminLock() })

/**
 * Whether this browser may call the routes the server marks `AdminOnly`: with
 * the admin lock off while accounts are off, as the owner once they are on.
 */
export const useCanManage = (): boolean => useManagement().canManage
