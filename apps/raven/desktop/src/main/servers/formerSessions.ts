import { join } from 'node:path'
import { isOpaqueId, isRecord } from '@raven/core'
import { loggable } from '@/main/servers/serverCalls'
import { ERROR_CODES, type Timers } from '@/main/stateStore'
import { messageOf } from '@/shared/messageOf'

/** The folder under userData where Electron keeps each `persist:` partition. */
export const PARTITIONS_DIR = 'Partitions'

// An older Raven kept each server's calls and PIN cookie in a `persist:server:<id>`
// partition; Electron 44 names its folder by its name past `persist:`, escaped: `server%3A<id>`.
// Main's calls now carry the page's own unlock, so none of them is read any more.
const PARTITION_FOLDER = /^server%3A(.+)$/u

/** How a step that races its budget ends. */
const RACE_OUTCOMES = { late: 'late' } as const

/** The folders in `names` that are an older Raven's server partitions. */
export const formerPartitions = ({ names }: { names: readonly string[] }): string[] =>
  names.filter((name) => {
    const id = PARTITION_FOLDER.exec(name)?.[1] ?? null
    return id !== null && isOpaqueId(id)
  })

const isMissing = (error: unknown): boolean => isRecord(error) && error.code === ERROR_CODES.enoent

/**
 * How long launch waits to list the partitions folder; a slow disk skips the cleanup this time
 * rather than hold the window.
 */
export const FORMER_LIST_MS = 1000

/**
 * Lists an older Raven's server partitions and starts removing them. It answers once the
 * folder is listed: `removing` settles when the removals do, and never rejects.
 */
export const clearFormerPartitions = async ({
  dir,
  fs,
  timers,
  warn,
}: {
  dir: string
  fs: {
    readdir: (path: string) => Promise<readonly string[]>
    remove: (path: string) => Promise<void>
  }
  timers: Timers
  warn: (message: string) => void
}): Promise<{ removing: Promise<void> }> => {
  const listing = fs.readdir(dir).catch((error: unknown): readonly string[] => {
    if (!isMissing(error)) {
      warn(`Raven could not read its server sessions: ${loggable(messageOf(error))}`)
    }
    return []
  })
  const budget: { handle: unknown } = { handle: null }
  const late = new Promise<typeof RACE_OUTCOMES.late>((resolve) => {
    budget.handle = timers.set({ run: () => resolve(RACE_OUTCOMES.late), ms: FORMER_LIST_MS })
  })
  const names = await Promise.race([listing, late]).finally(() => timers.clear(budget.handle))
  if (names === RACE_OUTCOMES.late) {
    warn(
      `Raven did not list its server sessions within ${FORMER_LIST_MS} ms, so it clears none this time`,
    )
    return { removing: Promise.resolve() }
  }
  const removals = formerPartitions({ names }).map((name) =>
    fs.remove(join(dir, name)).catch((error: unknown) => {
      warn(`Raven could not clear ${name}: ${loggable(messageOf(error))}`)
    }),
  )
  return { removing: Promise.all(removals).then(() => undefined) }
}
