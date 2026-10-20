import {
  type AccountServiceDeps,
  authorizeWith,
  createAccessEnds,
  createAccountService,
} from '@/main/accounts/accountService'
import { type AuthFetch, createAccountSessions } from '@/main/accounts/accountSessions'
import { type AuthConfigsDeps, createAuthConfigs } from '@/main/accounts/authConfigs'
import type { SessionStore } from '@/main/accounts/sessionStore'
import type { ConfigStore, ServerEntry } from '@/main/desktopConfig'
import { errorText } from '@/main/log/errorText'
import { createAccountTickets } from '@/main/servers/accountTickets'
import { createMediaRelay } from '@/main/servers/mediaRelay'
import { createServerCalls, NO_BEARER, type ServerFetch } from '@/main/servers/serverCalls'
import type { Timers } from '@/main/stateStore'

type RelayDeps = Parameters<typeof createMediaRelay>[0]

export type AccountStackDeps = {
  config: ConfigStore
  serverOf: (serverId: string) => ServerEntry | null
  /** Each server's own session fetch, which every server call goes out on. */
  fetchFor: (serverId: string) => ServerFetch
  sessionStore: Pick<SessionStore, 'storageFor' | 'isRemembered'>
  /** Main's own sheet asking whether to follow a server whose sign-in moved. */
  confirmSignInChange: AuthConfigsDeps['confirm']
  fetchAuth: AuthFetch
  timers: Timers
  warn: (message: string) => void
} & Pick<RelayDeps, 'listen' | 'fetchUpstream' | 'newSecret'> &
  Pick<AccountServiceDeps, 'openExternal' | 'emit' | 'info'>

/**
 * Main's account layer, wired: each server's public auth config, the sign-ins kept for it, the
 * server calls that carry their Bearer, the account tickets and the media relay. A sign out, a
 * removed server or a moved sign-in host ends the access held on its behalf (`accessEnds`).
 * Electron's parts come in as parameters, so `main.ts` alone imports it.
 */
export const createAccountStack = (deps: AccountStackDeps) => {
  const { config, serverOf, fetchFor, sessionStore, timers, warn } = deps
  // Without the Bearer layer below, which asks `authConfigs` for a server's state: its own
  // read of the public auth config must not ask itself.
  const authCalls = createServerCalls({ serverOf, fetchFor, ...NO_BEARER, warn })
  const accessEnds = createAccessEnds()
  const authConfigs = createAuthConfigs({
    calls: authCalls,
    config,
    confirm: deps.confirmSignInChange,
    // A yes to a moved sign-in host drops the session kept for the old one, and its access with it.
    forget: async (serverId) => {
      await accountSessions.forget(serverId)
      accessEnds.notify({ serverId })
    },
    now: Date.now,
    warn,
  })
  const accountSessions = createAccountSessions({
    storageFor: sessionStore.storageFor,
    configOf: authConfigs.readyOf,
    fetch: deps.fetchAuth,
    now: Date.now,
    timers,
    onEnded: (serverId) => accessEnds.notify({ serverId }),
    warn,
  })
  const serverCalls = createServerCalls({
    serverOf,
    fetchFor,
    authorize: authorizeWith({ authConfigs, sessions: accountSessions }),
    hasAccounts: ({ serverId }) => authConfigs.readyOf(serverId) !== null,
    refresh: ({ serverId }) => accountSessions.refresh(serverId),
    onRefusal: ({ serverId, isSessionRejected }) => {
      accounts.refused({ serverId, isSessionRejected }).catch((error: unknown) => {
        warn(`raven player could not follow up a refused call: ${errorText(error)}`)
      })
    },
    warn,
  })
  const accounts = createAccountService({
    authConfigs,
    sessions: accountSessions,
    calls: serverCalls,
    config,
    isRemembered: sessionStore.isRemembered,
    openExternal: deps.openExternal,
    accessEnds,
    emit: deps.emit,
    info: deps.info,
    warn,
  })
  const accountTickets = createAccountTickets({
    calls: serverCalls,
    sessions: accountSessions,
    now: Date.now,
  })
  const relay = createMediaRelay({
    listen: deps.listen,
    fetchUpstream: deps.fetchUpstream,
    tickets: accountTickets,
    newSecret: deps.newSecret,
    accountChanged: ({ serverId }) => accounts.changed(serverId),
    warn,
  })
  // A sign out, a removed server or a moved sign-in host: its title stops being relayed.
  accessEnds.listen(({ serverId }) => {
    relay.closeServer(serverId)
    accountTickets.forget(serverId)
  })
  return { authConfigs, serverCalls, accounts, accessEnds, accountTickets, relay }
}
