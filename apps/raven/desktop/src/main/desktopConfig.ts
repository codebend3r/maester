import {
  DEFAULT_OUTPUT_SETTINGS,
  isNumber,
  isOutputSettings,
  isPassthroughFormat,
  isString,
  listOf,
  object,
  oneOf,
  union,
  type Infer,
  type OutputSettings,
} from '@raven/core'
import { isOpaqueId } from '@/shared/protocol'
import { isServerOrigin } from '@/shared/playLink'
import { NAME_MAX, cleanName, nameFor, tidyText } from '@/main/servers/serverNames'
import { loadJson, type JsonStore, type StateFs } from '@/main/stateStore'

export const CONFIG_FILE = 'desktop-config.json'
export const SERVERS_CAP = 20

export const isServerEntry = object({
  id: isOpaqueId,
  origin: isServerOrigin,
  name: isString,
  addedAt: isNumber,
})

export type ServerEntry = Infer<typeof isServerEntry>

export const isDesktopConfig = object({
  version: oneOf([2]),
  output: isOutputSettings,
  servers: listOf(isServerEntry),
})

export type DesktopConfig = Infer<typeof isDesktopConfig>

/** What a file on disk may hold: this version, or the one before servers existed. */
export const isStoredConfig = union(
  object({ version: oneOf([1]), output: isOutputSettings }),
  isDesktopConfig,
)

export type ConfigStore = JsonStore<DesktopConfig>

export const EMPTY_CONFIG: DesktopConfig = {
  version: 2,
  output: DEFAULT_OUTPUT_SETTINGS,
  servers: [],
}

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

/** Rebuilds the settings from the four known fields, so nothing else a caller sent is stored. */
export const pickOutput = (output: OutputSettings): OutputSettings => ({
  profile: output.profile,
  device: output.device,
  passthrough: isPassthroughFormat.values.filter((format) => output.passthrough.includes(format)),
  spatial: output.spatial,
})

/**
 * Rebuilds each entry from its four fields, so nothing else a file carried is kept. Its
 * name is tidied as a typed one would be, and is the host when nothing is left of it.
 */
const pickServer = (server: ServerEntry): ServerEntry => ({
  id: server.id,
  origin: server.origin,
  name:
    cleanName(tidyText({ text: server.name, max: NAME_MAX })) ??
    nameFor(server.origin).slice(0, NAME_MAX),
  addedAt: server.addedAt,
})

/** The first servers up to the cap, skipping any whose id or origin an earlier one already has. */
const uniqueServers = (servers: readonly ServerEntry[]): ServerEntry[] =>
  servers.reduce<ServerEntry[]>((kept, server) => {
    const isSeen = kept.some((known) => known.id === server.id || known.origin === server.origin)
    if (isSeen || kept.length >= SERVERS_CAP) return kept
    return [...kept, pickServer(server)]
  }, [])

export const upgradeConfig = (stored: Infer<typeof isStoredConfig>): DesktopConfig => {
  switch (stored.version) {
    case 1:
      return { version: 2, output: pickOutput(stored.output), servers: [] }
    case 2:
      return {
        version: 2,
        output: pickOutput(stored.output),
        servers: uniqueServers(stored.servers),
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
}: {
  fs: StateFs
  file: string
  now: () => number
}): Promise<DesktopConfig> =>
  upgradeConfig(await loadJson({ fs, file, now, guard: isStoredConfig, empty: EMPTY_CONFIG }))
