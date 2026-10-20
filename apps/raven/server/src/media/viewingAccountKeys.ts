import type { Account } from '@raven/core'

/**
 * The account a server without accounts keeps its viewing under, and the
 * one every row recorded before accounts moved to. Never a Supabase user
 * id, which is a UUID, so the two cannot collide. Kept free of runtime
 * imports, since the migrations read it before anything else is wired.
 */
export const VIEWING_ACCOUNTS = { local: 'local' } as const

/** Whose progress, plays, watched marks and favourites a read or write is for. */
export type AccountKey = Account['id'] | typeof VIEWING_ACCOUNTS.local

/** What a statement over spots, favourites or plays binds as `@account`, beside its `?` values. */
export type ByAccount = { account: AccountKey }
