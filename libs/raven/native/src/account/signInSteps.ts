import { ADMIN_LOCK_STATES, type ApiClient } from '@raven/core'

import type { ActiveServerStore } from '@/servers/activeServerStore'
import { ADD_OUTCOMES, type AppServer } from '@/servers/serverList'
import { TICKET_SUPPORT, ticketSupportOf } from '@/servers/tickets'

/**
 * What signing in asks: the account's email and password, and last a word when the server hands
 * out no media tickets. The PIN and the admin password are never asked after an account signs
 * in, since the PIN is meant to stay a secret; only an end to end build, which has no account,
 * begins at them. `/unlock` is the one other way to the PIN.
 */
export const SIGN_IN_STEPS = {
  account: 'account',
  pin: 'pin',
  admin: 'admin',
  ticketsOff: 'ticketsOff',
} as const

/** A step that asks for a secret the server unlocks with. */
export type SecretStep = {
  kind: typeof SIGN_IN_STEPS.pin | typeof SIGN_IN_STEPS.admin
  server: AppServer
}

export type SignInStep =
  | { kind: typeof SIGN_IN_STEPS.account }
  | SecretStep
  | { kind: typeof SIGN_IN_STEPS.ticketsOff }

type SecretApi = Pick<ApiClient, 'unlock' | 'getAdminLock' | 'unlockAdmin'>

/** While the admin lock holds, the PIN opens nothing: locked libraries stay hidden. */
const isAdminLockHeld = async (api: SecretApi): Promise<boolean> => {
  const adminLock = await api.getAdminLock()
  return adminLock.state === ADMIN_LOCK_STATES.on && adminLock.available
}

type StepAfterSecretProps = { api: SecretApi; step: SecretStep; secret: string }

/**
 * Sends the step's secret, which throws the server's refusal, then the admin step after a PIN
 * the admin lock still holds back, else null for done.
 */
export const stepAfterSecret = async ({
  api,
  step,
  secret,
}: StepAfterSecretProps): Promise<SecretStep | null> => {
  if (step.kind === SIGN_IN_STEPS.admin) {
    await api.unlockAdmin(secret)
    return null
  }
  await api.unlock(secret)
  return (await isAdminLockHeld(api)) ? { kind: SIGN_IN_STEPS.admin, server: step.server } : null
}

/** How sign-in ends: done, done with no media tickets, or the server could not be kept. */
export const FINISH_OUTCOMES = {
  done: 'done',
  ticketsOff: 'ticketsOff',
  full: 'full',
  notAdded: 'notAdded',
} as const

type FinishOutcome = (typeof FINISH_OUTCOMES)[keyof typeof FINISH_OUTCOMES]

type FinishSignInProps = {
  servers: Pick<ActiveServerStore, 'getState'>
  server: AppServer
  api: Pick<ApiClient, 'getHome' | 'getMediaTicket'>
}

/** Keeps the server and makes it the active one, then learns whether it hands out tickets. */
export const finishSignIn = async ({
  servers,
  server,
  api,
}: FinishSignInProps): Promise<FinishOutcome> => {
  const { servers: known, add, activate } = servers.getState()
  const added = known.some(({ id }) => id === server.id) ? ADD_OUTCOMES.added : add(server).kind
  if (added === ADD_OUTCOMES.full) return FINISH_OUTCOMES.full
  if (added !== ADD_OUTCOMES.added) return FINISH_OUTCOMES.notAdded
  activate(server.id)
  const support = await ticketSupportOf({ api })
  return support === TICKET_SUPPORT.off ? FINISH_OUTCOMES.ticketsOff : FINISH_OUTCOMES.done
}
