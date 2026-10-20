import { oneOf } from '@raven/core'
import { useState } from 'react'
import { useAccount } from '@/renderer/desktop/accountApi'
import { ACCOUNT_STATES, type AccountView } from '@/shared/protocol'

/** The states of an account that let a title through: no accounts to ask, or one approved. */
const LET_IN_STATES = [
  ACCOUNT_STATES.off,
  ACCOUNT_STATES.unavailable,
  ACCOUNT_STATES.approved,
] as const

const isLetInState = oneOf(LET_IN_STATES)

type LetInState = (typeof LET_IN_STATES)[number]

export const GATE_KINDS = {
  reading: 'reading',
  unread: 'unread',
  walled: 'walled',
  letIn: 'letIn',
} as const

/**
 * Where a server's account leaves its title: still being read, unread with why, kept back in a
 * state the person acts on (sign in, wait for approval, see why the read failed), or let through.
 */
export type AccountGate =
  | { kind: typeof GATE_KINDS.reading }
  | { kind: typeof GATE_KINDS.unread; message: string }
  | {
      kind: typeof GATE_KINDS.walled
      account: AccountView
      state: Exclude<AccountView['state'], LetInState>
    }
  | { kind: typeof GATE_KINDS.letIn; state: LetInState }

/** What lets the title through after a read: one that could not check the account keeps the last answer. */
const letInAfter = ({
  read,
  letInAs,
}: {
  read: AccountView['state'] | null
  letInAs: LetInState | null
}): LetInState | null => {
  if (read === null || read === ACCOUNT_STATES.failed) return letInAs
  return isLetInState(read) ? read : null
}

const gateOf = ({
  account,
  error,
  letIn,
}: {
  account: AccountView | undefined
  error: Error | null
  letIn: LetInState | null
}): AccountGate => {
  if (account === undefined) {
    return error === null
      ? { kind: GATE_KINDS.reading }
      : { kind: GATE_KINDS.unread, message: error.message }
  }
  if (letIn !== null) return { kind: GATE_KINDS.letIn, state: letIn }
  const { state } = account
  return isLetInState(state)
    ? { kind: GATE_KINDS.letIn, state }
    : { kind: GATE_KINDS.walled, account, state }
}

/**
 * A server's account as the gate in front of its title. The state that let the title through
 * stands until an answer takes it back, so a passing outage never stops a playing title.
 */
export const useAccountGate = (serverId: string) => {
  const account = useAccount(serverId)
  const [letInAs, setLetInAs] = useState<LetInState | null>(null)
  const letIn = letInAfter({ read: account.data?.state ?? null, letInAs })
  if (letIn !== letInAs) setLetInAs(letIn)
  return { account, gate: gateOf({ account: account.data, error: account.error, letIn }) }
}
