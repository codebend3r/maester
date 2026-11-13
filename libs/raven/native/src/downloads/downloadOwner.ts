/** What signing in does to the downloads on the device. */
export const OWNER_DECISIONS = {
  /** Nobody signed in, or their owner: they stay as they are. */
  keep: 'keep',
  /** They have no owner yet, as downloads kept before owners were: the account claims them. */
  claim: 'claim',
  /** Another account's: they all go, files too, and the newcomer owns what follows. */
  replace: 'replace',
} as const

export type OwnerDecision = (typeof OWNER_DECISIONS)[keyof typeof OWNER_DECISIONS]

type OwnerDecisionOfProps = {
  /** The account the downloads belong to; null for none yet. */
  ownerId: string | null
  /** The account signed in now; null signed out. */
  accountId: string | null
}

/**
 * What the downloads do as `accountId` signs in. A sign-out and the same account signing back
 * in keep them, out of reach behind sign-in meanwhile, since they hold its playlists and what
 * its PIN unlocked; only a different account removes them.
 */
export const ownerDecisionOf = ({ ownerId, accountId }: OwnerDecisionOfProps): OwnerDecision => {
  if (accountId === null || ownerId === accountId) return OWNER_DECISIONS.keep
  return ownerId === null ? OWNER_DECISIONS.claim : OWNER_DECISIONS.replace
}

/** The owner a persisted value names: a string, or null for none, as an older version kept none. */
export const savedOwnerOf = (saved: unknown): string | null =>
  typeof saved === 'object' &&
  saved !== null &&
  'ownerId' in saved &&
  typeof saved.ownerId === 'string'
    ? saved.ownerId
    : null
