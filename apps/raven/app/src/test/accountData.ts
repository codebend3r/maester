import {
  ACCOUNT_COLUMNS,
  ACCOUNT_REST_PATH,
  ACCOUNT_TABLES,
  AUTH_CONFIG_STATES,
  AUTH_COOKIE,
  AUTH_PATHS,
  type AccountServer,
  type FetchInit,
  type FetchLike,
  HTTP_METHODS,
  type LibraryPin,
  POSTGREST,
  ROUTES,
  type ServerName,
  isRecord,
  isString,
} from '@raven/core'
import type { AppServer } from '@raven/native/headless'
import { STATUSES, healthOf, responseOf } from '@raven/native/testing'
import { HTTP_STATUSES } from '@shared/http'

import { useAccountSession } from '@/account/session'

/** Home's own id, as its auth config names it. */
export const HOME_SERVER_ID = '3f2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d'

/** Another server on the account: Meleys, at its own address. */
export const MELEYS: AppServer = {
  id: '5d6e7f80-91a2-4b3c-8d4e-5f60718293a4',
  name: 'Meleys',
  origin: 'https://meleys.example:8443',
  addedAt: 1795428000000,
}

const SUPABASE_URL = 'https://project.supabase.co'

const MELEYS_ROW: AccountServer = {
  id: '9b2d3f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
  serverId: MELEYS.id,
  name: MELEYS.name,
  origin: MELEYS.origin,
  addedAt: '2026-11-23T10:00:00.000Z',
}

/** The account's database and the servers' open answers, as a test sets them. */
export type AccountData = {
  rows: AccountServer[]
  pins: LibraryPin[]
  /** The names the account gave servers it keeps no row for: its home one. */
  names: ServerName[]
  /** Each server's id on its open health, by origin; a server not named does not answer. */
  health: Record<string, string>
}

export const accountDataOf = ({
  rows = [],
  pins = [],
  names = [],
  health = {},
}: Partial<AccountData> = {}): AccountData => ({ rows, pins, names, health })

/** The account's row for Meleys, as its database lists it. */
export const meleysRow = (): AccountServer => ({ ...MELEYS_ROW })

const READY_CONFIG = {
  state: AUTH_CONFIG_STATES.ready,
  serverId: HOME_SERVER_ID,
  supabaseUrl: SUPABASE_URL,
  publishableKey: 'sb_publishable_test',
  webUrl: 'https://raven.example',
  cookieName: AUTH_COOKIE,
}

/** PostgREST's `column=eq.value` filters of a request, by column. */
const filtersOf = (url: string): Record<string, string> =>
  Object.fromEntries(
    (url.split('?')[1] ?? '')
      .split('&')
      .map((pair) => pair.split('='))
      .flatMap(([key, value]) =>
        key !== undefined && value !== undefined && value.startsWith(POSTGREST.equals)
          ? [[key, decodeURIComponent(value.slice(POSTGREST.equals.length))]]
          : [],
      ),
  )

const bodyOf = (init: FetchInit): Record<string, unknown> => {
  const body: unknown = init.body === undefined ? {} : JSON.parse(init.body)
  return isRecord(body) ? body : {}
}

// PostgREST answers an insert with 201, which the fixtures' statuses leave out.
const TABLE_STATUSES = { ...STATUSES, created: HTTP_STATUSES.created } as const

/** The account database's tables, under PostgREST's `/rest/v1`. */
const TABLES = {
  servers: `${SUPABASE_URL}${ACCOUNT_REST_PATH}${ACCOUNT_TABLES.servers}`,
  pins: `${SUPABASE_URL}${ACCOUNT_REST_PATH}${ACCOUNT_TABLES.pins}`,
  names: `${SUPABASE_URL}${ACCOUNT_REST_PATH}${ACCOUNT_TABLES.serverNames}`,
} as const

type AnswerProps = { body: unknown; status?: number }

const serverIdOf = (body: Record<string, unknown>): string => {
  const serverId = body[ACCOUNT_COLUMNS.serverId]
  return isString(serverId) ? serverId : MELEYS.id
}

const answer = ({ body, status = TABLE_STATUSES.ok }: AnswerProps) => responseOf({ status, body })

type TableProps = { data: AccountData; url: string; init: FetchInit }

const serversTable = ({ data, url, init }: TableProps) => {
  const method = init.method ?? HTTP_METHODS.get
  const { id } = filtersOf(url)
  const body = bodyOf(init)
  if (method === HTTP_METHODS.get) return answer({ body: data.rows })
  if (method === HTTP_METHODS.delete) {
    data.rows = data.rows.filter((row) => row.id !== id)
    data.pins = data.pins.filter((pin) => data.rows.some((row) => row.serverId === pin.serverId))
    return answer({ body: null, status: TABLE_STATUSES.noContent })
  }
  if (method === HTTP_METHODS.patch) {
    data.rows = data.rows.map((row) =>
      row.id === id && isString(body.name) ? { ...row, name: body.name } : row,
    )
    return answer({ body: data.rows.filter((row) => row.id === id) })
  }
  const added: AccountServer = {
    ...MELEYS_ROW,
    id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    serverId: serverIdOf(body),
    name: isString(body.name) ? body.name : MELEYS.name,
    origin: isString(body.origin) ? body.origin : MELEYS.origin,
  }
  data.rows = [...data.rows, added]
  return answer({ body: [added], status: TABLE_STATUSES.created })
}

const pinsTable = ({ data, url, init }: TableProps) => {
  const method = init.method ?? HTTP_METHODS.get
  if (method === HTTP_METHODS.get) return answer({ body: data.pins })
  if (method === HTTP_METHODS.delete) {
    const filters = filtersOf(url)
    data.pins = data.pins.filter(
      (pin) =>
        pin.serverId !== filters[ACCOUNT_COLUMNS.serverId] ||
        String(pin.libraryId) !== filters[ACCOUNT_COLUMNS.libraryId],
    )
    return answer({ body: null, status: TABLE_STATUSES.noContent })
  }
  const body = bodyOf(init)
  const serverId = body[ACCOUNT_COLUMNS.serverId]
  const libraryId = body[ACCOUNT_COLUMNS.libraryId]
  data.pins = [
    ...data.pins,
    {
      serverId: isString(serverId) ? serverId : '',
      libraryId: typeof libraryId === 'number' ? libraryId : 0,
      pinnedAt: '2026-11-23T11:00:00.000Z',
    },
  ]
  return answer({ body: null, status: TABLE_STATUSES.created })
}

/** The account's names: read whole, or one upserted by its server's id. */
const namesTable = ({ data, init }: TableProps) => {
  if ((init.method ?? HTTP_METHODS.get) === HTTP_METHODS.get) return answer({ body: data.names })
  const body = bodyOf(init)
  const named = { serverId: serverIdOf(body), name: isString(body.name) ? body.name : '' }
  data.names = [...data.names.filter(({ serverId }) => serverId !== named.serverId), named]
  return answer({ body: [named], status: TABLE_STATUSES.created })
}

/**
 * Answers the app's account calls as a device would hear them: home's auth config, each
 * server's open health and the account's three tables, which it keeps in `data` as the database
 * would. A test hands it to `accountServersFor` in place of the device's `fetch`.
 */
export const accountFetchOf =
  (data: AccountData): FetchLike =>
  async (url, init = {}) => {
    if (url.endsWith(AUTH_PATHS.config)) return answer({ body: READY_CONFIG })
    if (url.endsWith(ROUTES.getServerHealth.path)) {
      const origin = url.slice(0, -ROUTES.getServerHealth.path.length)
      const serverId = data.health[origin]
      if (serverId === undefined) throw new TypeError('Network request failed')
      return answer({ body: healthOf(serverId) })
    }
    if (url.startsWith(TABLES.servers)) {
      return serversTable({ data, url, init })
    }
    if (url.startsWith(TABLES.pins)) {
      return pinsTable({ data, url, init })
    }
    if (url.startsWith(TABLES.names)) {
      return namesTable({ data, url, init })
    }
    throw new TypeError('Network request failed')
  }

/** Signs a test account in, as the pins and the account's list need. */
export const signInTestAccount = (): void => {
  useAccountSession.setState({
    session: {
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3_600_000,
      userId: '11111111-2222-4333-8444-555555555555',
      email: 'viewer@example.com',
    },
  })
}
