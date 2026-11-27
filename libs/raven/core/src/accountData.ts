import { HTTP_STATUSES } from '@shared/http'
import { type CreatePostgrestProps, type RowsRead, createPostgrest } from '@/accountData/postgrest'
import { ApiError } from '@/apiClient/transport'
import {
  type AccountPreferences,
  type AccountServer,
  DEFAULT_ACCOUNT_PREFERENCES,
  type LibraryPin,
  type ServerId,
  type ServerName,
  DEVICE_SIGN_IN_ARGS,
  DEVICE_SIGN_IN_RPCS,
  isAccountPreferences,
  isAccountServer,
  isLibraryPin,
  isServerName,
} from '@/contract'
import { cleanName } from '@/names'
import { isBoolean, isString, nullable } from '@/schema'
import { serverOriginOf } from '@/serverOrigin'

export { ACCOUNT_REST_PATH, ACCOUNT_RPC_PATH, POSTGREST } from '@/accountData/postgrest'

/** The account's tables in its Supabase database, under PostgREST's `/rest/v1`. */
export const ACCOUNT_TABLES = {
  servers: 'account_servers',
  pins: 'library_pins',
  serverNames: 'server_names',
  preferences: 'account_preferences',
} as const

/**
 * How often an open app reads the account's servers and their names again, so a rename made on
 * another device shows here without a relaunch. Every client also reads them on coming back to
 * the front.
 */
export const ACCOUNT_DATA_REFRESH_MS = 30_000

/** The columns the clients send and filter on, as the tables name them. */
export const ACCOUNT_COLUMNS = {
  id: 'id',
  serverId: 'server_id',
  libraryId: 'library_id',
  name: 'name',
  origin: 'origin',
  addedAt: 'added_at',
  pinnedAt: 'pinned_at',
  userId: 'user_id',
  namedAt: 'named_at',
  showPinServers: 'show_pin_servers',
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

/** A server name row read back in the contract's names. */
const SERVER_NAME_ROWS = {
  select: [`serverId:${ACCOUNT_COLUMNS.serverId}`, ACCOUNT_COLUMNS.name].join(','),
  guard: isServerName,
} as const satisfies RowsRead<ServerName>

/** The account's preferences row read back in the contract's names. */
const PREFERENCES_ROWS = {
  select: `showPinServers:${ACCOUNT_COLUMNS.showPinServers}`,
  guard: isAccountPreferences,
} as const satisfies RowsRead<AccountPreferences>

/** Why a write to the account's rows was refused: before it was sent, or for matching no row of the account's. */
const ACCOUNT_DATA_PROBLEMS = {
  name: 'A server name must be 1 to 80 characters with no hidden characters.',
  origin: 'A server address must be an http or https origin.',
  notFound: 'That is not on this account.',
} as const

type AddServerProps = { serverId: ServerId; name: string; origin: string }

type RenameServerProps = { id: string; name: string }

type RemoveServerProps = { id: string }

type PinProps = { serverId: ServerId; libraryId: number }

type NameServerProps = { serverId: ServerId; name: string }

type SetPreferencesProps = AccountPreferences

type DeviceCodeProps = { code: string }

// What `device_sign_in_request` answers: the device's name, or null for a code that does not stand.
const isDeviceName = nullable(isString)

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

/** The one row a write answered with, or a 404 when no row of the caller's matched. */
const writtenRow = <T>([row]: readonly T[]): T => {
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
      return writtenRow(
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
      writtenRow(
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

    /** The names the account gave servers it keeps no row for, oldest first. */
    listServerNames: (): Promise<ServerName[]> =>
      rest.list({
        table: ACCOUNT_TABLES.serverNames,
        ...SERVER_NAME_ROWS,
        orderBy: ACCOUNT_COLUMNS.namedAt,
      }),

    /** Names a server the account keeps no row for (its home one), or names it again. */
    nameServer: async ({ serverId, name }: NameServerProps): Promise<ServerName> =>
      writtenRow(
        await rest.upsert({
          table: ACCOUNT_TABLES.serverNames,
          row: {
            [ACCOUNT_COLUMNS.serverId]: serverId,
            [ACCOUNT_COLUMNS.name]: cleanNameOrThrow(name),
          },
          returning: SERVER_NAME_ROWS,
          onConflict: [ACCOUNT_COLUMNS.userId, ACCOUNT_COLUMNS.serverId],
        }),
      ),

    /** The account's preferences, or the defaults for one that never changed them. */
    readPreferences: async (): Promise<AccountPreferences> => {
      const [row] = await rest.list({
        table: ACCOUNT_TABLES.preferences,
        ...PREFERENCES_ROWS,
        orderBy: ACCOUNT_COLUMNS.userId,
      })
      return row ?? DEFAULT_ACCOUNT_PREFERENCES
    },

    /** Writes the account's preferences, making its row the first time. */
    setPreferences: async ({ showPinServers }: SetPreferencesProps): Promise<AccountPreferences> =>
      writtenRow(
        await rest.upsert({
          table: ACCOUNT_TABLES.preferences,
          row: { [ACCOUNT_COLUMNS.showPinServers]: showPinServers },
          returning: PREFERENCES_ROWS,
          onConflict: [ACCOUNT_COLUMNS.userId],
        }),
      ),

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

    /** The name of the device showing `code`, or null for a code that is unknown, spent or past its time. */
    deviceSignInRequest: ({ code }: DeviceCodeProps): Promise<string | null> =>
      rest.rpc({
        name: DEVICE_SIGN_IN_RPCS.request,
        args: { [DEVICE_SIGN_IN_ARGS.code]: code },
        guard: isDeviceName,
      }),

    /** Signs the device showing `code` in as this account; false when the code no longer stands. */
    approveDeviceSignIn: ({ code }: DeviceCodeProps): Promise<boolean> =>
      rest.rpc({
        name: DEVICE_SIGN_IN_RPCS.approve,
        args: { [DEVICE_SIGN_IN_ARGS.code]: code },
        guard: isBoolean,
      }),
  }
}

export type AccountDataClient = ReturnType<typeof createAccountDataClient>

type AccountDataClientsForProps = Pick<CreatePostgrestProps, 'accessToken' | 'fetch'>

/** The Supabase project a client reads: the address and key the server's auth config names. */
type AccountProject = Pick<CreatePostgrestProps, 'supabaseUrl' | 'publishableKey'>

/**
 * An app's account database clients, one per Supabase project and made the first time it is
 * asked for, all with the app's own token and `fetch`: what a web page hands its account queries,
 * so every render of them reads one client and a test spies on that one.
 */
export const accountDataClientsFor = ({
  accessToken,
  fetch,
}: AccountDataClientsForProps): ((project: AccountProject) => AccountDataClient) => {
  const clients = new Map<string, AccountDataClient>()
  return ({ supabaseUrl, publishableKey }) => {
    const key = `${supabaseUrl} ${publishableKey}`
    const known = clients.get(key)
    if (known !== undefined) return known
    const client = createAccountDataClient({ supabaseUrl, publishableKey, accessToken, fetch })
    clients.set(key, client)
    return client
  }
}
