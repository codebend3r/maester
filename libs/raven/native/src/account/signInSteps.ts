import type { ApiClient } from '@raven/core'

import type { ActiveServerStore } from '@/servers/activeServerStore'
import { ADD_OUTCOMES, type AppServer } from '@/servers/serverList'
import { TICKET_SUPPORT, ticketSupportOf } from '@/servers/tickets'

/**
 * What signing in asks: the account's email and password, and last a word when the server
 * hands out no media tickets. It never asks for a PIN or an admin password.
 */
export const SIGN_IN_STEPS = {
  account: 'account',
  ticketsOff: 'ticketsOff',
} as const

export type SignInStep =
  | { kind: typeof SIGN_IN_STEPS.account }
  | { kind: typeof SIGN_IN_STEPS.ticketsOff }

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
