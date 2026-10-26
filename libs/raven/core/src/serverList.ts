import { cleanName } from '@/names'

/** The most servers a client keeps on its list. */
export const SERVERS_CAP = 20

/**
 * The name a new server starts with: its origin's host, as punycode, with the port when it
 * is not the scheme's default, which is how `serverOriginOf` writes it.
 */
export const serverNameFor = (origin: string): string => origin.slice(origin.indexOf('//') + 2)

type RenamedServersProps<T extends { id: string; name: string }> = {
  servers: readonly T[]
  id: string
  name: string
}

/**
 * `servers` with the one `id` names given the name typed, tidied by `cleanName`; null when the
 * name will not do (blank, past `NAME_MAX`, or holding a hidden character) or no server has
 * the id. Every client's list is renamed by it.
 */
export const renamedServers = <T extends { id: string; name: string }>({
  servers,
  id,
  name,
}: RenamedServersProps<T>): T[] | null => {
  const cleaned = cleanName(name)
  if (cleaned === null || !servers.some((server) => server.id === id)) return null
  return servers.map((server) => (server.id === id ? { ...server, name: cleaned } : server))
}
