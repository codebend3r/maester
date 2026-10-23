import {
  DEFAULT_OUTPUT_SETTINGS,
  type Infer,
  isBoolean,
  isNumber,
  isOpaqueId,
  isOutputSettings,
  isPassthroughFormat,
  isString,
  listOf,
  nullable,
  object,
  oneOf,
  type OutputSettings,
  union,
} from '@raven/core'
import { isServerOrigin } from '@/shared/playLink'
import { loadJson, type JsonStore, type StateFs } from '@/main/stateStore'

export const CONFIG_FILE = 'desktop-config.json'

/** What Raven calls its server in what it says: it plays from that one alone. */
export const SERVER_NAME = 'raven'

/** Said of a server an older Raven kept besides, which Raven no longer reaches. */
export const SERVER_GONE = 'Raven no longer plays from that server.'

/**
 * The server Raven plays from, by the opaque id its downloads are filed under, and the
 * origin that id was given for. Versions 2 to 4 kept a list of these, each with more fields
 * (a name, when it was added, version 4's pinned sign-in), which are no longer read.
 */
const isServerRecord = object({ id: isOpaqueId, origin: isServerOrigin })

type ServerRecord = Infer<typeof isServerRecord>

/** The server as the rest of main reads it: its record, and the name Raven says. */
export type ServerEntry = ServerRecord & { name: string }

/** Whether the release check runs at launch, and when it last answered. */
const isUpdateSettings = object({ isEnabled: isBoolean, checkedAt: nullable(isNumber) })

export type UpdateSettings = Infer<typeof isUpdateSettings>

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = { isEnabled: true, checkedAt: null }

export const isDesktopConfig = object({
  version: oneOf([5]),
  output: isOutputSettings,
  server: isServerRecord,
  updates: isUpdateSettings,
  /**
   * The last account the page signed in to the server with, kept past a sign out and a relaunch,
   * so what is watched before the page signs in again waits for that account. Null until one has.
   */
  lastAccountId: nullable(isString),
})

export type DesktopConfig = Infer<typeof isDesktopConfig>

/**
 * What a file on disk may hold: this version, the one before Raven kept a single
 * server, the one before sign-ins were pinned, the one before the release check, or the one
 * before servers existed.
 */
export const isStoredConfig = union(
  object({ version: oneOf([1]), output: isOutputSettings }),
  object({ version: oneOf([2]), output: isOutputSettings, servers: listOf(isServerRecord) }),
  object({
    version: oneOf([3, 4]),
    output: isOutputSettings,
    servers: listOf(isServerRecord),
    updates: isUpdateSettings,
  }),
  isDesktopConfig,
)

type StoredConfig = Infer<typeof isStoredConfig>

export type ConfigStore = JsonStore<DesktopConfig>

/** A missing file reads as the first version, which takes the server with a new id. */
const NO_CONFIG: StoredConfig = { version: 1, output: DEFAULT_OUTPUT_SETTINGS }

/**
 * The server a build plays from (`RAVEN_DESKTOP_SERVER_ORIGIN`) and the other origins its links
 * may name for it (`RAVEN_DESKTOP_LINK_ORIGINS`).
 */
export type FixedServer = { origin: string; aliases: readonly string[] }

/** Whether `origin` names the fixed server: its own origin, or one of its aliases. */
export const namesServer = ({ server, origin }: { server: FixedServer; origin: string }): boolean =>
  origin === server.origin || server.aliases.includes(origin)

/** The server as main reads it, with the name Raven says. */
export const serverOf = (config: DesktopConfig): ServerEntry => ({
  ...config.server,
  name: SERVER_NAME,
})

/** The server when `serverId` is its id; null for any other, such as a server an older version kept. */
export const serverById = ({
  config,
  serverId,
}: {
  config: DesktopConfig
  serverId: string
}): ServerEntry | null => (config.server.id === serverId ? serverOf(config) : null)

export const setOutput = ({
  config,
  output,
}: {
  config: DesktopConfig
  output: OutputSettings
}): DesktopConfig => ({
  ...config,
  output,
})

/** The account the page signed in with now, kept as the last one. */
export const setLastAccount = ({
  config,
  accountId,
}: {
  config: DesktopConfig
  accountId: string
}): DesktopConfig => ({
  ...config,
  lastAccountId: accountId,
})

export const setUpdates = ({
  config,
  updates,
}: {
  config: DesktopConfig
  updates: UpdateSettings
}): DesktopConfig => ({
  ...config,
  updates,
})

/** Rebuilds the settings from the four known fields, so nothing else a caller sent is stored. */
export const pickOutput = (output: OutputSettings): OutputSettings => ({
  profile: output.profile,
  device: output.device,
  passthrough: isPassthroughFormat.values.filter((format) => output.passthrough.includes(format)),
  spatial: output.spatial,
})

/**
 * The config; the ids of the servers an older version kept that were the fixed server too (its
 * origin and an alias added as two), whose downloads move to the server's id; and whether it is
 * not what the file holds, so main writes it at once and the server keeps its id next launch.
 */
export type UpgradedConfig = { config: DesktopConfig; adopted: string[]; isChanged: boolean }

/**
 * The id the fixed server goes by: the first kept server that names it, so its downloads keep
 * their files, owed plays and sync; else a new one. The other servers that name it are adopted.
 */
const fromList = ({
  servers,
  server,
  newId,
}: {
  servers: readonly ServerRecord[]
  server: FixedServer
  newId: () => string
}): { id: string; adopted: string[] } => {
  const ids = [
    ...new Set(servers.filter(({ origin }) => namesServer({ server, origin })).map(({ id }) => id)),
  ]
  const [first, ...adopted] = ids
  return { id: first ?? newId(), adopted }
}

/** The stored update settings rebuilt from their two fields; the defaults before version 3 had any. */
const updatesOf = (stored: StoredConfig): UpdateSettings => {
  switch (stored.version) {
    case 1:
    case 2:
      return { ...DEFAULT_UPDATE_SETTINGS }
    case 3:
    case 4:
    case 5:
      return { isEnabled: stored.updates.isEnabled, checkedAt: stored.updates.checkedAt }
    default: {
      const unreachable: never = stored
      return unreachable
    }
  }
}

const configFor = ({
  stored,
  id,
  origin,
  lastAccountId = null,
}: {
  stored: StoredConfig
  id: string
  origin: string
  lastAccountId?: string | null
}): DesktopConfig => ({
  version: 5,
  output: pickOutput(stored.output),
  server: { id, origin },
  updates: updatesOf(stored),
  lastAccountId,
})

/**
 * Any version, as version 5 for the fixed server. A version 5 server keeps its id and its last
 * account whatever origin the build names now, so its downloads stay filed where they are and
 * nothing has to move: only the origin is written anew.
 */
export const upgradeConfig = ({
  stored,
  server,
  newId,
}: {
  stored: StoredConfig
  server: FixedServer
  newId: () => string
}): UpgradedConfig => {
  const { origin } = server
  switch (stored.version) {
    case 1:
      return { config: configFor({ stored, id: newId(), origin }), adopted: [], isChanged: true }
    case 2:
    case 3:
    case 4: {
      const { id, adopted } = fromList({ servers: stored.servers, server, newId })
      return { config: configFor({ stored, id, origin }), adopted, isChanged: true }
    }
    case 5:
      return {
        config: configFor({
          stored,
          id: stored.server.id,
          origin,
          lastAccountId: stored.lastAccountId,
        }),
        adopted: [],
        isChanged: stored.server.origin !== origin,
      }
    default: {
      const unreachable: never = stored
      return unreachable
    }
  }
}

export const loadConfig = async ({
  fs,
  file,
  now,
  server,
  newId,
}: {
  fs: StateFs
  file: string
  now: () => number
  server: FixedServer
  newId: () => string
}): Promise<UpgradedConfig> =>
  upgradeConfig({
    stored: await loadJson({ fs, file, now, guard: isStoredConfig, empty: NO_CONFIG }),
    server,
    newId,
  })
