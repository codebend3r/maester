import { HTTP_STATUSES } from '@shared/http'
import { type CreatePostgrestProps, type RowsRead, createPostgrest } from '@/accountData/postgrest'
import { ApiError } from '@/apiClient/transport'
import {
  type AccountServer,
  type LibraryPin,
  type ServerId,
  isAccountServer,
  isLibraryPin,
} from '@/contract'
import { cleanName } from '@/names'
import { serverOriginOf } from '@/serverOrigin'

export { ACCOUNT_REST_PATH, POSTGREST } from '@/accountData/postgrest'

/** The account's tables in its Supabase database, under PostgREST's `/rest/v1`. */
export const ACCOUNT_TABLES = {
  servers: 'account_servers',
  pins: 'library_pins',
} as const

/** The columns the clients send and filter on, as the tables name them. */
export const ACCOUNT_COLUMNS = {
  id: 'id',
  serverId: 'server_id',
  libraryId: 'library_id',
  name: 'name',
  origin: 'origin',
  addedAt: 'added_at',
  pinnedAt: 'pinned_at',
} as const

/** A server row read back in the contract's names: PostgREST renames `alias:column`. */
const SERVER_ROWS = {
  select: [
    ACCOUNT_COLUMNS.id,
    `serverId:${ACCOUNT_COLUMNS.serverId}`,
    ACCOUNT_COLUMNS.name,
    ACCOUNT_COLUMNS.origin,
    `addedAt:${ACCOUNT_COLUMNS.addedAt}`,
  ].join(','),
  guard: isAccountServer,
} as const satisfies RowsRead<AccountServer>

/** A pin row read back in the contract's names. */
const PIN_ROWS = {
  select: [
    `serverId:${ACCOUNT_COLUMNS.serverId}`,
    `libraryId:${ACCOUNT_COLUMNS.libraryId}`,
    `pinnedAt:${ACCOUNT_COLUMNS.pinnedAt}`,
  ].join(','),
  guard: isLibraryPin,
} as const satisfies RowsRead<LibraryPin>

/** Why a server's write was refused: before it was sent, or for matching no row of the account's. */
const ACCOUNT_DATA_PROBLEMS = {
  name: 'A server name must be 1 to 80 characters with no hidden characters.',
  origin: 'A server address must be an http or https origin.',
  notFound: 'That server is not on this account.',
} as const

type AddServerProps = { serverId: ServerId; name: string; origin: string }

type RenameServerProps = { id: string; name: string }

type RemoveServerProps = { id: string }

type PinProps = { serverId: ServerId; libraryId: number }

/** `name` as `cleanName` tidies it, refused before it is sent when it will not do. */
const cleanNameOrThrow = (name: string): string => {
  const cleaned = cleanName(name)
  if (cleaned === null) {
    throw new ApiError({ status: HTTP_STATUSES.badRequest, message: ACCOUNT_DATA_PROBLEMS.name })
  }
  return cleaned
}

/** `origin` as `serverOriginOf` reads it, refused before it is sent when it is no origin. */
const cleanOriginOrThrow = (origin: string): string => {
  const cleaned = serverOriginOf(origin)
  if (cleaned === null) {
    throw new ApiError({ status: HTTP_STATUSES.badRequest, message: ACCOUNT_DATA_PROBLEMS.origin })
  }
  return cleaned
}

/** The one server row a write answered with, or a 404 when no row of the caller's matched. */
const writtenServer = ([row]: readonly AccountServer[]): AccountServer => {
  if (row === undefined) {
    throw new ApiError({ status: HTTP_STATUSES.notFound, message: ACCOUNT_DATA_PROBLEMS.notFound })
  }
  return row
}

/**
 * The account's server list and library pins, read and written in its
 * Supabase database through PostgREST with the publishable key and the
 * account's own token. Row level security keeps every call to the caller's
 * rows; the database owns each row's account and caps the lists.
 */
export const createAccountDataClient = (props: CreatePostgrestProps) => {
  const rest = createPostgrest(props)

  return {
    /** The account's extra servers, oldest first. */
    listServers: (): Promise<AccountServer[]> =>
      rest.list({
        table: ACCOUNT_TABLES.servers,
        ...SERVER_ROWS,
        orderBy: ACCOUNT_COLUMNS.addedAt,
      }),

    /** Adds a server by its id, with its name tidied and its address read as `serverOriginOf` reads it. */
    addServer: async ({ serverId, name, origin }: AddServerProps): Promise<AccountServer> => {
      const cleanedOrigin = cleanOriginOrThrow(origin)
      return writtenServer(
        await rest.insert({
          table: ACCOUNT_TABLES.servers,
          row: {
            [ACCOUNT_COLUMNS.serverId]: serverId,
            [ACCOUNT_COLUMNS.name]: cleanNameOrThrow(name),
            [ACCOUNT_COLUMNS.origin]: cleanedOrigin,
          },
          returning: SERVER_ROWS,
        }),
      )
    },

    /** Gives one of the account's servers a new name. */
    renameServer: async ({ id, name }: RenameServerProps): Promise<AccountServer> =>
      writtenServer(
        await rest.update({
          table: ACCOUNT_TABLES.servers,
          where: { [ACCOUNT_COLUMNS.id]: id },
          changes: { [ACCOUNT_COLUMNS.name]: cleanNameOrThrow(name) },
          returning: SERVER_ROWS,
        }),
      ),

    /** Takes a server off the account, and with it every pin on that server. */
    removeServer: ({ id }: RemoveServerProps): Promise<void> =>
      rest.remove({ table: ACCOUNT_TABLES.servers, where: { [ACCOUNT_COLUMNS.id]: id } }),

    /** The account's pinned libraries on every server, in the order they were pinned. */
    listPins: (): Promise<LibraryPin[]> =>
      rest.list({ table: ACCOUNT_TABLES.pins, ...PIN_ROWS, orderBy: ACCOUNT_COLUMNS.pinnedAt }),

    /** Pins a library; pinning one already pinned changes nothing. */
    pinLibrary: ({ serverId, libraryId }: PinProps): Promise<void> =>
      rest.insertOnce({
        table: ACCOUNT_TABLES.pins,
        row: { [ACCOUNT_COLUMNS.serverId]: serverId, [ACCOUNT_COLUMNS.libraryId]: libraryId },
      }),

    /** Unpins a library; one not pinned changes nothing. */
    unpinLibrary: ({ serverId, libraryId }: PinProps): Promise<void> =>
      rest.remove({
        table: ACCOUNT_TABLES.pins,
        where: { [ACCOUNT_COLUMNS.serverId]: serverId, [ACCOUNT_COLUMNS.libraryId]: libraryId },
      }),
  }
}

export type AccountDataClient = ReturnType<typeof createAccountDataClient>
