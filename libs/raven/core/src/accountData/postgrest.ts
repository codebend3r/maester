import { CONTENT_TYPES, HEADERS, HTTP_METHODS, type HttpMethod } from '@shared/http'
import {
  ApiError,
  type FetchLike,
  type FetchResponse,
  errorMessage,
  readJson,
} from '@/apiClient/transport'
import { AUTH_HEADERS, AUTH_SCHEME } from '@/contract'
import { pathWithQuery, withoutTrailingSlash } from '@/query'
import { type Guard } from '@/schema'

/** Where PostgREST serves the tables, under the project's address. */
export const ACCOUNT_REST_PATH = '/rest/v1/'

/** PostgREST's query keys and operators. */
export const POSTGREST = {
  select: 'select',
  order: 'order',
  equals: 'eq.',
  onConflict: 'on_conflict',
  ascending: '.asc',
} as const

// Where a function is called, under the tables' own root.
const RPC_ROOT = 'rpc/'

/** Where a project answers a function's call: the function's name follows. */
export const ACCOUNT_RPC_PATH = `${ACCOUNT_REST_PATH}${RPC_ROOT}`

/** What a write asks PostgREST to answer: the row written, nothing, or nothing for a row already there. */
const PREFERENCES = {
  row: 'return=representation',
  nothing: 'return=minimal',
  keepExisting: 'resolution=ignore-duplicates,return=minimal',
  replaceExisting: 'resolution=merge-duplicates,return=representation',
} as const

type Preference = (typeof PREFERENCES)[keyof typeof PREFERENCES]

const PROBLEMS = {
  notUnderstood: 'The account database sent a response this client does not understand.',
  failed: 'The account database refused the request.',
} as const

export type CreatePostgrestProps = {
  /** The project's address, `supabaseUrl` in the server's `GET /api/auth/config`. */
  supabaseUrl: string
  /** The project's publishable key, `publishableKey` in the same answer. */
  publishableKey: string
  /** The signed-in account's access token, or null while signed out. */
  accessToken: () => Promise<string | null>
  fetch: FetchLike
}

/** The rows a call reads back: the columns it selects, and the guard each row must pass. */
export type RowsRead<T> = { select: string; guard: Guard<T> }

/** The rows a write or a removal is held to: each column equal to its value. */
type Where = Record<string, string | number>

type RequestProps = {
  /** A table's name, or a function's place under `RPC_ROOT`. */
  path: string
  method: HttpMethod
  query: Record<string, string>
  body?: Record<string, unknown>
  prefer?: Preference
}

type ListProps<T> = RowsRead<T> & {
  table: string
  /** The column the rows come ordered by, lowest first. */
  orderBy: string
}

type InsertProps<T> = { table: string; row: Record<string, unknown>; returning: RowsRead<T> }

type InsertOnceProps = { table: string; row: Record<string, unknown> }

type UpsertProps<T> = InsertProps<T> & {
  /** The columns of the key a row already there is found by, the caller's own left to the database. */
  onConflict: readonly string[]
}

type UpdateProps<T> = {
  table: string
  where: Where
  changes: Record<string, unknown>
  returning: RowsRead<T>
}

type RemoveProps = { table: string; where: Where }

type RpcProps<T> = { name: string; args: Record<string, unknown>; guard: Guard<T> }

type ReadRowsProps<T> = { response: FetchResponse; guard: Guard<T> }

/** The rows of an answer that pass `guard`; one that does not is left out alone. */
const readRows = async <T>({ response, guard }: ReadRowsProps<T>): Promise<T[]> => {
  const body = await readJson(response)
  if (!Array.isArray(body)) {
    throw new ApiError({ status: response.status, message: PROBLEMS.notUnderstood })
  }
  return body.filter(guard)
}

const filtersOf = (where: Where): Record<string, string> =>
  Object.fromEntries(
    Object.entries(where).map(([column, value]) => [column, `${POSTGREST.equals}${value}`]),
  )

/**
 * The calls a client makes to a Supabase project's tables through PostgREST,
 * with the publishable key and the account's own token. A refusal rejects
 * with an `ApiError` carrying the database's own message.
 */
export const createPostgrest = ({
  supabaseUrl,
  publishableKey,
  accessToken,
  fetch,
}: CreatePostgrestProps) => {
  const root = `${withoutTrailingSlash(supabaseUrl)}${ACCOUNT_REST_PATH}`

  const request = async ({
    path,
    method,
    query,
    body,
    prefer,
  }: RequestProps): Promise<FetchResponse> => {
    const token = await accessToken()
    const response = await fetch(`${root}${pathWithQuery({ path, query })}`, {
      method,
      headers: {
        [HEADERS.accept]: CONTENT_TYPES.json,
        [AUTH_HEADERS.apiKey]: publishableKey,
        ...(token === null ? {} : { [AUTH_HEADERS.authorization]: `${AUTH_SCHEME} ${token}` }),
        ...(body === undefined ? {} : { [HEADERS.contentType]: CONTENT_TYPES.json }),
        ...(prefer === undefined ? {} : { [HEADERS.prefer]: prefer }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (response.ok) return response
    throw new ApiError({
      status: response.status,
      message: errorMessage({ body: await readJson(response), fallback: PROBLEMS.failed }),
    })
  }

  return {
    /** A table's rows the caller may see, ordered by one column, lowest first. */
    list: async <T>({ table, select, guard, orderBy }: ListProps<T>): Promise<T[]> => {
      const response = await request({
        path: table,
        method: HTTP_METHODS.get,
        query: {
          [POSTGREST.select]: select,
          [POSTGREST.order]: `${orderBy}${POSTGREST.ascending}`,
        },
      })
      return readRows({ response, guard })
    },

    /** Adds a row and answers it as the table wrote it. */
    insert: async <T>({ table, row, returning }: InsertProps<T>): Promise<T[]> => {
      const response = await request({
        path: table,
        method: HTTP_METHODS.post,
        query: { [POSTGREST.select]: returning.select },
        body: row,
        prefer: PREFERENCES.row,
      })
      return readRows({ response, guard: returning.guard })
    },

    /** Adds a row; one already there under the same key changes nothing. */
    insertOnce: async ({ table, row }: InsertOnceProps): Promise<void> => {
      await request({
        path: table,
        method: HTTP_METHODS.post,
        query: {},
        body: row,
        prefer: PREFERENCES.keepExisting,
      })
    },

    /** Adds a row, or changes the one already there under the same key, and answers it as the table wrote it. */
    upsert: async <T>({ table, row, returning, onConflict }: UpsertProps<T>): Promise<T[]> => {
      const response = await request({
        path: table,
        method: HTTP_METHODS.post,
        query: {
          [POSTGREST.onConflict]: onConflict.join(','),
          [POSTGREST.select]: returning.select,
        },
        body: row,
        prefer: PREFERENCES.replaceExisting,
      })
      return readRows({ response, guard: returning.guard })
    },

    /** Changes the rows `where` names and answers each as it now reads; none when no row matched. */
    update: async <T>({ table, where, changes, returning }: UpdateProps<T>): Promise<T[]> => {
      const response = await request({
        path: table,
        method: HTTP_METHODS.patch,
        query: { ...filtersOf(where), [POSTGREST.select]: returning.select },
        body: changes,
        prefer: PREFERENCES.row,
      })
      return readRows({ response, guard: returning.guard })
    },

    /** Removes the rows `where` names; none matching changes nothing. */
    remove: async ({ table, where }: RemoveProps): Promise<void> => {
      await request({
        path: table,
        method: HTTP_METHODS.delete,
        query: filtersOf(where),
        prefer: PREFERENCES.nothing,
      })
    },

    /** Calls one of the database's functions and answers what it returned, held to `guard`. */
    rpc: async <T>({ name, args, guard }: RpcProps<T>): Promise<T> => {
      const response = await request({
        path: `${RPC_ROOT}${name}`,
        method: HTTP_METHODS.post,
        query: {},
        body: args,
      })
      const body = await readJson(response)
      if (!guard(body)) {
        throw new ApiError({ status: response.status, message: PROBLEMS.notUnderstood })
      }
      return body
    },
  }
}
