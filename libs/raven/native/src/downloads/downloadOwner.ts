/** What signing in does to the downloads on the device. */
export const OWNER_DECISIONS = {
  /** Nobody signed in, or their owner: they stay as they are. */
  keep: 'keep',
  /** They have no owner yet, as downloads kept before owners were: the account claims them. */
  claim: 'claim',
  /** Another account's: they all go, files too, and the newcomer owns what follows. */
  replace: 'replace',
} as const

type OwnerDecision = (typeof OWNER_DECISIONS)[keyof typeof OWNER_DECISIONS]

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

type KeepForOwnerProps = OwnerDecisionOfProps & {
  /** Removes every download, files too. */
  removeAll: () => Promise<void>
  /** Writes the downloads' new owner. */
  own: (ownerId: string | null) => void
}

/**
 * Carries out `ownerDecisionOf` on a downloads store: claims them for `accountId` when they have
 * no owner, removes them all and hands them to it when another account owns them, and keeps
 * them otherwise. Answers whether they were removed.
 */
export const keepForOwner = async ({
  ownerId,
  accountId,
  removeAll,
  own,
}: KeepForOwnerProps): Promise<boolean> => {
  const decision = ownerDecisionOf({ ownerId, accountId })
  if (decision === OWNER_DECISIONS.keep) return false
  if (decision === OWNER_DECISIONS.replace) await removeAll()
  own(accountId)
  return decision === OWNER_DECISIONS.replace
}

/** The owner a persisted value names: a string, or null for none, as an older version kept none. */
export const savedOwnerOf = (saved: unknown): string | null =>
  typeof saved === 'object' &&
  saved !== null &&
  'ownerId' in saved &&
  typeof saved.ownerId === 'string'
    ? saved.ownerId
    : null
