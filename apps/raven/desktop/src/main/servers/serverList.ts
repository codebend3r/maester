import { type DesktopConfig, type ServerEntry, SERVERS_CAP } from '@/main/desktopConfig'
import { cleanName, nameFor } from '@/main/servers/serverNames'
import { isServerOrigin } from '@/shared/playLink'
import { isOpaqueId } from '@/shared/protocol'

export { SERVERS_CAP } from '@/main/desktopConfig'
export { NAME_MAX, cleanName, nameFor } from '@/main/servers/serverNames'

export const serverById = ({
  config,
  serverId,
}: {
  config: DesktopConfig
  serverId: string
}): ServerEntry | null => config.servers.find((server) => server.id === serverId) ?? null

export const serverByOrigin = ({
  config,
  origin,
}: {
  config: DesktopConfig
  origin: string
}): ServerEntry | null => config.servers.find((server) => server.origin === origin) ?? null

export const ADD_REFUSALS = { full: 'full', invalid: 'invalid', taken: 'taken' } as const

export type AddOutcome =
  | { ok: true; config: DesktopConfig; server: ServerEntry }
  | { ok: false; reason: 'full' | 'invalid' | 'taken' }

export const addServer = ({
  config,
  id,
  origin,
  at,
}: {
  config: DesktopConfig
  id: string
  origin: string
  at: number
}): AddOutcome => {
  // The entry names a session on disk and is read back by `isServerEntry`, so both are checked here too.
  if (!isServerOrigin(origin) || !isOpaqueId(id)) return { ok: false, reason: ADD_REFUSALS.invalid }
  const known = serverByOrigin({ config, origin })
  if (known !== null) return { ok: true, config, server: known }
  if (config.servers.length >= SERVERS_CAP) return { ok: false, reason: ADD_REFUSALS.full }
  if (serverById({ config, serverId: id }) !== null)
    return { ok: false, reason: ADD_REFUSALS.taken }
  const server: ServerEntry = { id, origin, name: nameFor(origin), addedAt: at }
  return { ok: true, config: { ...config, servers: [...config.servers, server] }, server }
}

export const renameServer = ({
  config,
  serverId,
  name,
}: {
  config: DesktopConfig
  serverId: string
  name: string
}): DesktopConfig | null => {
  const cleaned = cleanName(name)
  if (cleaned === null || serverById({ config, serverId }) === null) return null
  return {
    ...config,
    servers: config.servers.map((server) =>
      server.id === serverId ? { ...server, name: cleaned } : server,
    ),
  }
}

/** The config without the server; the same object when it has no such server. */
export const removeServer = ({
  config,
  serverId,
}: {
  config: DesktopConfig
  serverId: string
}): DesktopConfig => {
  if (serverById({ config, serverId }) === null) return config
  return { ...config, servers: config.servers.filter((server) => server.id !== serverId) }
}
