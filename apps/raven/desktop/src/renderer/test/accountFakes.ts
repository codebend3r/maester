import { S } from '@/renderer/test/serverFakes'
import { ACCOUNT_STATES, type AccountView } from '@/shared/protocol'

/** An account on Vhagar, signed out unless `overrides` say otherwise. */
export const accountOf = (overrides: Partial<AccountView> = {}): AccountView => ({
  serverId: S,
  state: ACCOUNT_STATES.signedOut,
  email: null,
  isRemembered: true,
  signInHost: 'project.supabase.co',
  ...overrides,
})
