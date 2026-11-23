import {
  AUTH_CONFIG_STATES,
  type AccountServer,
  type FetchLike,
  type Library,
  type ServerId,
  createAccountDataClient,
  createApiClient,
  isOpaqueId,
} from '@raven/core'
import { SERVER_NAME, type ServerEntry } from '@/main/desktopConfig'
import { errorText } from '@/main/log/errorText'
import { quietly } from '@/main/log/quietly'
import { loggable } from '@/main/servers/serverCalls'

/** Why main will not use, or read, one of the account's servers. */
export const DIRECTORY_MESSAGES = {
  signedOut: 'Sign in to use another server.',
  noAccounts: `${SERVER_NAME} keeps no accounts, so there is no other server to use.`,
  unlisted: 'That server is not on your account.',
  otherServer: 'That address answers as another server now.',
  unreachable: 'Raven could not reach that server.',
} as const

/** One of the account's servers main has confirmed, or why it will not use it. */
export type Confirmed =
  | { ok: true; server: ServerEntry }
  | { ok: false; message: (typeof DIRECTORY_MESSAGES)[keyof typeof DIRECTORY_MESSAGES] }

/** The account's rows, or why there are none to read. */
type Listed = { ok: true; rows: AccountServer[] } | Extract<Confirmed, { ok: false }>

/** What a server's open `/api/health` said of it: its id, null for one too old to have one. */
type Checked = { ok: true; serverId: ServerId | null } | { ok: false }

export type ServerDirectory = {
  /**
   * The account's server by `serverId`, as main reads the account's own list itself (never an
   * origin the page names), once its open `/api/health` answers that same id. One that does not
   * answer is still used, as the account lists it: its pages say it is out of reach until it is
   * back. One that answers as another server, or as none, is refused.
   */
  confirm: (serverId: string) => Promise<Confirmed>
  /** A server's open `/api/health`, read with nothing of the account's: for a server being added. */
  check: (origin: string) => Promise<Checked>
  /** The libraries of one of the account's servers, for the pins kept on it; null when there are none to read. */
  librariesOf: (serverId: string) => Promise<Library[] | null>
  /** Another account signed in, or none: the servers confirmed for the last one are read again. */
  forget: () => void
}

type CreateServerDirectoryProps = {
  /** The server the build plays from, whose account config names the account's database. */
  home: ServerEntry
  /** A bare fetch: no cookie, no redirect, a timeout and a capped body (`fetchAccountReads`). */
  fetch: FetchLike
  /** The page's access token, the Bearer for the account's list and another server's libraries. */
  accessToken: () => string | null
  warn: (message: string) => void
}

/**
 * Main's reads of the account's other servers, beside the allowlist: the account's list from its
 * Supabase database (the project the home server's `GET /api/auth/config` names, read with the
 * publishable key and the page's Bearer), a server's open health, and another server's library
 * list. Each server confirmed is kept for the account until it changes, so a pin read or a switch
 * back does not read the list again.
 */
export const createServerDirectory = ({
  home,
  fetch,
  accessToken,
  warn,
}: CreateServerDirectoryProps): ServerDirectory => {
  const safeWarn = quietly(warn)
  let confirmed: ReadonlyMap<string, ServerEntry> = new Map()

  const homeApi = createApiClient({ baseUrl: home.origin, fetch })

  const listed = async (): Promise<Listed> => {
    if (accessToken() === null) return { ok: false, message: DIRECTORY_MESSAGES.signedOut }
    const config = await homeApi.getAuthConfig()
    if (config.state !== AUTH_CONFIG_STATES.ready) {
      return { ok: false, message: DIRECTORY_MESSAGES.noAccounts }
    }
    const account = createAccountDataClient({
      supabaseUrl: config.supabaseUrl,
      publishableKey: config.publishableKey,
      accessToken: async () => accessToken(),
      fetch,
    })
    return { ok: true, rows: await account.listServers() }
  }

  const check: ServerDirectory['check'] = async (origin) => {
    try {
      const health = await createApiClient({ baseUrl: origin, fetch }).getServerHealth()
      return { ok: true, serverId: health.serverId ?? null }
    } catch {
      return { ok: false }
    }
  }

  const confirmFresh = async (serverId: string): Promise<Confirmed> => {
    const list = await listed()
    if (!list.ok) return list
    const row = list.rows.find((known) => known.serverId === serverId)
    if (row === undefined) return { ok: false, message: DIRECTORY_MESSAGES.unlisted }
    const health = await check(row.origin)
    if (health.ok && health.serverId !== serverId) {
      safeWarn(`an account server's address answers as another server`)
      return { ok: false, message: DIRECTORY_MESSAGES.otherServer }
    }
    const server = { id: serverId, origin: row.origin }
    confirmed = new Map([...confirmed, [serverId, server]])
    return { ok: true, server }
  }

  const confirm: ServerDirectory['confirm'] = async (serverId) => {
    // Downloads are filed under the id, so it must be one their folders can carry.
    if (!isOpaqueId(serverId)) return { ok: false, message: DIRECTORY_MESSAGES.unlisted }
    const known = confirmed.get(serverId)
    if (known !== undefined) return { ok: true, server: known }
    try {
      return await confirmFresh(serverId)
    } catch (error) {
      safeWarn(`Raven could not read the account's servers: ${loggable(errorText(error))}`)
      return { ok: false, message: DIRECTORY_MESSAGES.unreachable }
    }
  }

  const librariesOf: ServerDirectory['librariesOf'] = async (serverId) => {
    const found = await confirm(serverId)
    if (!found.ok) return null
    try {
      return await createApiClient({
        baseUrl: found.server.origin,
        fetch,
        accessToken,
      }).listLibraries()
    } catch {
      return null
    }
  }

  return {
    confirm,
    check,
    librariesOf,
    forget: () => {
      confirmed = new Map()
    },
  }
}
