import { create } from 'zustand'

import { type AccountAnswer, hasAccounts } from '@/servers/authConfigs'
import type { AppServer } from '@/servers/serverList'

type AccountAnswersState = {
  /** What each server said of its accounts when sign-in last asked, this run, by server id. */
  answers: Readonly<Record<string, AccountAnswer>>
  hear: (input: { serverId: string; answer: AccountAnswer }) => void
}

/**
 * What the servers said of their accounts this run, kept in memory only: after a relaunch a
 * server's pin speaks for it until sign-in asks again (`hasAccounts`).
 */
export const useAccountAnswers = create<AccountAnswersState>()((set) => ({
  answers: {},
  hear: ({ serverId, answer }) =>
    set(({ answers }) => ({ answers: { ...answers, [serverId]: answer } })),
}))

/** Whether `server` signs in with accounts, at this call: what it last said, else its pin. */
export const hasAccountsNow = (server: Pick<AppServer, 'id' | 'account'>): boolean =>
  hasAccounts({
    account: server.account,
    answer: useAccountAnswers.getState().answers[server.id] ?? null,
  })
