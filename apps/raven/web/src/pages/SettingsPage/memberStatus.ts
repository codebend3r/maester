import { MEMBER_STATUSES } from '@raven/core'

export type MemberStatus = (typeof MEMBER_STATUSES)[keyof typeof MEMBER_STATUSES]

/** What each access status is called, in the words a person reads. */
export const STATUS_NAMES = {
  [MEMBER_STATUSES.pending]: 'Pending',
  [MEMBER_STATUSES.approved]: 'Approved',
  [MEMBER_STATUSES.revoked]: 'Removed',
} as const satisfies Record<MemberStatus, string>
