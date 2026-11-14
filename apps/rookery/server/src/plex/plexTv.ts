import {
  CONTENT_TYPES,
  HEADERS,
  HTTP_METHODS,
  HTTP_STATUSES,
  type HttpMethod,
  isRecord,
  isSuccessStatus,
} from '@shared/server'

/**
 * Plex's PIN sign-in, as plex.tv documents it for third-party apps: create a
 * strong PIN, send the browser to Plex's auth app with the PIN's code, and
 * check the PIN for a token once Plex sends the browser back. The token
 * fetches the account and is then dropped; rookery never stores one.
 */

/** The plex.tv client headers maester has always sent, so plex.tv keeps seeing the same app. */
const PLEX_PRODUCT = 'maester'
const PLEX_CLIENT_ID = 'maester'

const PLEX_TV = 'https://plex.tv'
const PLEX_AUTH_APP = 'https://app.plex.tv/auth'
const TIMEOUT_MS = 10_000

const PLEX_HEADERS = {
  product: 'X-Plex-Product',
  clientIdentifier: 'X-Plex-Client-Identifier',
  token: 'X-Plex-Token',
} as const

/** plex.tv's API paths rookery calls. */
const PLEX_PATHS = {
  pins: '/api/v2/pins',
  user: '/api/v2/user',
} as const

/** The query keys plex.tv's PIN API and auth app read. */
const PLEX_QUERY = {
  clientId: 'clientID',
  code: 'code',
  product: 'context[device][product]',
  forwardUrl: 'forwardUrl',
  strong: 'strong',
} as const

export type PlexPin = { id: string; code: string }

export type PlexAccount = {
  id: string
  username: string
  email: string | null
  thumb: string | null
}

/** plex.tv failed or did not answer in time. */
export class PlexUnavailable extends Error {}

export type PlexTv = {
  createPin(): Promise<PlexPin>
  /** The PIN's token once the friend has approved it, or null while they have not (or it expired). */
  checkPin(pin: PlexPin): Promise<string | null>
  account(token: string): Promise<PlexAccount>
}

/** The DI token the plex.tv client is provided under. */
export const PLEX_TV_CLIENT = Symbol('PLEX_TV_CLIENT')

type PlexAuthUrlProps = { code: string; forwardUrl: string }

/** Where the browser goes to approve `code`; Plex sends it on to `forwardUrl` afterwards. */
export const plexAuthUrl = ({ code, forwardUrl }: PlexAuthUrlProps): string =>
  `${PLEX_AUTH_APP}#?${new URLSearchParams({
    [PLEX_QUERY.clientId]: PLEX_CLIENT_ID,
    [PLEX_QUERY.code]: code,
    [PLEX_QUERY.product]: PLEX_PRODUCT,
    [PLEX_QUERY.forwardUrl]: forwardUrl,
  }).toString()}`

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

const idText = (value: unknown): string | null =>
  typeof value === 'number' && Number.isInteger(value) ? String(value) : text(value)

type HttpPlexTvRequestProps = {
  method?: HttpMethod
  path: string
  token?: string
}

/** What plex.tv answered: its status, and its JSON body or null. */
type PlexAnswer = { status: number; body: unknown }

export class HttpPlexTv implements PlexTv {
  private async request({
    method = HTTP_METHODS.get,
    path,
    token,
  }: HttpPlexTvRequestProps): Promise<PlexAnswer> {
    try {
      const response = await fetch(`${PLEX_TV}${path}`, {
        method,
        headers: {
          [HEADERS.accept]: CONTENT_TYPES.json,
          [PLEX_HEADERS.product]: PLEX_PRODUCT,
          [PLEX_HEADERS.clientIdentifier]: PLEX_CLIENT_ID,
          ...(token ? { [PLEX_HEADERS.token]: token } : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const body: unknown = await response.json().catch(() => null)
      return { status: response.status, body }
    } catch (error) {
      throw new PlexUnavailable(`plex.tv ${method} ${path}: ${String(error)}`)
    }
  }

  async createPin(): Promise<PlexPin> {
    const { status, body } = await this.request({
      method: HTTP_METHODS.post,
      path: `${PLEX_PATHS.pins}?${new URLSearchParams({ [PLEX_QUERY.strong]: String(true) }).toString()}`,
    })
    const id = isRecord(body) ? idText(body.id) : null
    const code = isRecord(body) ? text(body.code) : null
    if (!isSuccessStatus(status) || id == null || code == null) {
      throw new PlexUnavailable(`plex.tv created no PIN (${status})`)
    }
    return { id, code }
  }

  async checkPin(pin: PlexPin): Promise<string | null> {
    const { status, body } = await this.request({
      path: `${PLEX_PATHS.pins}/${encodeURIComponent(pin.id)}?${new URLSearchParams({ [PLEX_QUERY.code]: pin.code }).toString()}`,
    })
    // An expired PIN is gone from plex.tv; to the friend that is the same as not approving it.
    if (status === HTTP_STATUSES.notFound) return null
    if (!isSuccessStatus(status) || !isRecord(body)) {
      throw new PlexUnavailable(`plex.tv PIN check (${status})`)
    }
    return text(body.authToken)
  }

  async account(token: string): Promise<PlexAccount> {
    const { status, body } = await this.request({ path: PLEX_PATHS.user, token })
    const id = isRecord(body) ? idText(body.id) : null
    if (!isSuccessStatus(status) || !isRecord(body) || id == null) {
      throw new PlexUnavailable(`plex.tv returned no account (${status})`)
    }
    return {
      id,
      username: text(body.username) ?? text(body.title) ?? id,
      email: text(body.email),
      thumb: text(body.thumb),
    }
  }
}
