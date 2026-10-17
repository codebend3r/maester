import { join } from 'node:path'
import { isRecord } from '@raven/core'
import { fetchThrough, loggable, type ServerFetch } from '@/main/servers/serverCalls'
import { ERROR_CODES, type Timers } from '@/main/stateStore'
import { messageOf } from '@/shared/messageOf'
import { isOpaqueId } from '@/shared/protocol'

/** How long removing a server waits on its session's clears before it lets trust move on. */
export const FORGET_TIMEOUT_MS = 5000

/** The folder under userData where Electron keeps each `persist:` partition. */
export const PARTITIONS_DIR = 'Partitions'

// Electron 44 names a `persist:server:<id>` partition's folder by its name past `persist:`,
// escaped: `server%3A<id>`.
const PARTITION_FOLDER = /^server%3A(.+)$/u

/** How a step that races its budget ends. */
const RACE_OUTCOMES = { cleared: 'cleared', late: 'late' } as const

/** The parts of an Electron `Session` a server's calls, cookies and removal use. */
export type ServerSession = {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  cookies: {
    get: (filter: { url: string }) => Promise<readonly { name: string; value: string }[]>
  }
  clearStorageData: () => Promise<void>
  clearCache: () => Promise<void>
  setPermissionRequestHandler: (
    handler: (
      contents: unknown,
      permission: string,
      callback: (isGranted: boolean) => void,
    ) => void,
  ) => void
  setPermissionCheckHandler: (handler: (contents: unknown, permission: string) => boolean) => void
}

export type ServerSessions = {
  sessionOf: (serverId: string) => ServerSession
  fetchFor: (serverId: string) => ServerFetch
  cookiesFor: (input: {
    serverId: string
    url: string
  }) => Promise<readonly { name: string; value: string }[]>
  forget: (serverId: string) => Promise<void>
}

export const partitionFor = ({ serverId }: { serverId: string }): string =>
  `persist:server:${serverId}`

/**
 * One persistent session per server, made on first use, so one server's cookies never
 * ride along to another. Nothing in them is a page, so every permission is refused.
 */
export const createServerSessions = ({
  fromPartition,
  timers,
  warn,
}: {
  fromPartition: (partition: string) => ServerSession
  timers: Timers
  warn: (message: string) => void
}): ServerSessions => {
  let sessions: ReadonlyMap<string, ServerSession> = new Map()

  const sessionOf = (serverId: string): ServerSession => {
    // The id names a folder on disk.
    if (!isOpaqueId(serverId)) throw new Error('That is not a server id.')
    const known = sessions.get(serverId)
    if (known !== undefined) return known
    const made = fromPartition(partitionFor({ serverId }))
    made.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    made.setPermissionCheckHandler(() => false)
    sessions = new Map([...sessions, [serverId, made]])
    return made
  }

  const forget = async (serverId: string): Promise<void> => {
    // A server this run never used still has its session on disk, so it is opened to clear it.
    const session = sessionOf(serverId)
    const timer: { handle: unknown } = { handle: undefined }
    const deadline = new Promise<typeof RACE_OUTCOMES.late>((resolve) => {
      timer.handle = timers.set({ run: () => resolve(RACE_OUTCOMES.late), ms: FORGET_TIMEOUT_MS })
    })
    try {
      const outcome = await Promise.race([
        Promise.all([session.clearStorageData(), session.clearCache()]).then(
          () => RACE_OUTCOMES.cleared,
        ),
        deadline,
      ])
      if (outcome === RACE_OUTCOMES.late) {
        warn(
          `raven player gave up clearing server ${serverId}'s session after ${FORGET_TIMEOUT_MS} ms`,
        )
      }
    } finally {
      timers.clear(timer.handle)
      sessions = new Map([...sessions].filter(([id]) => id !== serverId))
    }
  }

  return {
    sessionOf,
    fetchFor: (serverId) => fetchThrough((url, init) => sessionOf(serverId).fetch(url, init)),
    cookiesFor: async ({ serverId, url }) => {
      const cookies = await sessionOf(serverId).cookies.get({ url })
      return cookies.map(({ name, value }) => ({ name, value }))
    },
    forget,
  }
}

/** The folders in `names` that are server partitions the config no longer holds. */
export const orphanPartitions = ({
  names,
  keep,
}: {
  names: readonly string[]
  keep: readonly string[]
}): string[] =>
  names.filter((name) => {
    const id = PARTITION_FOLDER.exec(name)?.[1] ?? null
    return id !== null && isOpaqueId(id) && !keep.includes(id)
  })

const isMissing = (error: unknown): boolean => isRecord(error) && error.code === ERROR_CODES.enoent

/**
 * How long launch waits to list the partitions folder. Listing comes before any server
 * session is made, so a session made this run is never in the list; a slow disk skips
 * the cleanup this time rather than hold the window.
 */
export const ORPHAN_LIST_MS = 1000

/**
 * Lists the server partitions the config does not hold (a server whose adding was never
 * saved, or whose removal could not clear it) and starts removing them. It answers once
 * the folder is listed: `removing` settles when the removals do, and never rejects.
 */
export const clearOrphanPartitions = async ({
  dir,
  keep,
  fs,
  timers,
  warn,
}: {
  dir: string
  keep: readonly string[]
  fs: {
    readdir: (path: string) => Promise<readonly string[]>
    remove: (path: string) => Promise<void>
  }
  timers: Timers
  warn: (message: string) => void
}): Promise<{ removing: Promise<void> }> => {
  const listing = fs.readdir(dir).catch((error: unknown): readonly string[] => {
    if (!isMissing(error)) {
      warn(`raven player could not read its server sessions: ${loggable(messageOf(error))}`)
    }
    return []
  })
  const budget: { handle: unknown } = { handle: null }
  const late = new Promise<typeof RACE_OUTCOMES.late>((resolve) => {
    budget.handle = timers.set({ run: () => resolve(RACE_OUTCOMES.late), ms: ORPHAN_LIST_MS })
  })
  const names = await Promise.race([listing, late]).finally(() => timers.clear(budget.handle))
  if (names === RACE_OUTCOMES.late) {
    warn(
      `raven player did not list its server sessions within ${ORPHAN_LIST_MS} ms, so it clears none this time`,
    )
    return { removing: Promise.resolve() }
  }
  const removals = orphanPartitions({ names, keep }).map((name) =>
    fs.remove(join(dir, name)).catch((error: unknown) => {
      warn(`raven player could not clear ${name}: ${loggable(messageOf(error))}`)
    }),
  )
  return { removing: Promise.all(removals).then(() => undefined) }
}
