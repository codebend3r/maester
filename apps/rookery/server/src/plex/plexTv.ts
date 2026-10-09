/**
 * Plex's PIN sign-in, as plex.tv documents it for third-party apps: create a
 * strong PIN, send the browser to Plex's auth app with the PIN's code, and
 * check the PIN for a token once Plex sends the browser back. The token
 * fetches the account and is then dropped; rookery never stores one.
 */

/** The plex.tv client headers maester has always sent, so plex.tv keeps seeing the same app. */
export const PLEX_PRODUCT = 'maester'
export const PLEX_CLIENT_ID = 'maester'

const PLEX_TV = 'https://plex.tv'
const PLEX_AUTH_APP = 'https://app.plex.tv/auth'
const TIMEOUT_MS = 10_000

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

/** Where the browser goes to approve `code`; Plex sends it on to `forwardUrl` afterwards. */
export const plexAuthUrl = ({ code, forwardUrl }: { code: string; forwardUrl: string }): string =>
  `${PLEX_AUTH_APP}#?${new URLSearchParams({
    clientID: PLEX_CLIENT_ID,
    code,
    'context[device][product]': PLEX_PRODUCT,
    forwardUrl,
  }).toString()}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value)

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

const idText = (value: unknown): string | null =>
  typeof value === 'number' && Number.isInteger(value) ? String(value) : text(value)

export class HttpPlexTv implements PlexTv {
  private async request({
    method = 'GET',
    path,
    token,
  }: {
    method?: 'GET' | 'POST'
    path: string
    token?: string
  }): Promise<{ status: number; body: unknown }> {
    try {
      const response = await fetch(`${PLEX_TV}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          'X-Plex-Product': PLEX_PRODUCT,
          'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
          ...(token ? { 'X-Plex-Token': token } : {}),
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
      method: 'POST',
      path: '/api/v2/pins?strong=true',
    })
    const id = isRecord(body) ? idText(body.id) : null
    const code = isRecord(body) ? text(body.code) : null
    if (status >= 300 || id == null || code == null) {
      throw new PlexUnavailable(`plex.tv created no PIN (${status})`)
    }
    return { id, code }
  }

  async checkPin(pin: PlexPin): Promise<string | null> {
    const { status, body } = await this.request({
      path: `/api/v2/pins/${encodeURIComponent(pin.id)}?code=${encodeURIComponent(pin.code)}`,
    })
    // An expired PIN is gone from plex.tv; to the friend that is the same as not approving it.
    if (status === 404) return null
    if (status >= 300 || !isRecord(body)) throw new PlexUnavailable(`plex.tv PIN check (${status})`)
    return text(body.authToken)
  }

  async account(token: string): Promise<PlexAccount> {
    const { status, body } = await this.request({ path: '/api/v2/user', token })
    const id = isRecord(body) ? idText(body.id) : null
    if (status >= 300 || !isRecord(body) || id == null) {
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
