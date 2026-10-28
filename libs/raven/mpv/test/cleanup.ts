import { strict as assert } from 'node:assert'
import { createRequire } from 'node:module'
import { setTimeout as sleep } from 'node:timers/promises'
import { isMainThread, Worker, workerData } from 'node:worker_threads'
import { isNumber, isRecord, object } from '@raven/core'
import { MPV_COMMANDS, MPV_SURFACE_KINDS } from '@/mpv'
import { MPV_PROPERTIES } from '@/properties'
import { localAddonPath } from '@/target'
import { CLEANUP_MODES, isCleanupMode } from '@/test/cleanupModes'

const ignoreEvent = () => {}
const isCounts = object({ owners: isNumber, callbacks: isNumber, handles: isNumber })
const isFunction = (value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === 'function'
type Handle = {
  command: (id: number, args: string[]) => void
  set: (id: number, name: string, value: number | boolean) => void
  observe: (name: string) => void
  destroy: () => Promise<void>
}
const isHandle = (value: unknown): value is Handle =>
  isRecord(value) && ['command', 'set', 'observe', 'destroy'].every((key) => isFunction(value[key]))
const addon: unknown = createRequire(import.meta.url)(localAddonPath())
if (!isRecord(addon) || !isFunction(addon.create) || !isFunction(addon.lifecycleCounts))
  throw new Error('Invalid native cleanup-test binding')
const { create, lifecycleCounts } = addon
const counts = () => {
  const value: unknown = lifecycleCounts()
  if (!isCounts(value)) throw new Error('Invalid native lifecycle counts')
  return value
}
type CollectUntilProps = {
  matches: () => boolean
  deadline?: number
  rounds?: number
}

const collectUntil = async ({
  matches,
  deadline = Date.now() + 15000,
  rounds = 0,
}: CollectUntilProps): Promise<void> => {
  if (typeof global.gc !== 'function') throw new Error('Cleanup test requires --expose-gc')
  global.gc()
  await sleep(10)
  if (matches()) return
  if (Date.now() > deadline)
    throw new Error(
      `Native reclamation timed out after ${rounds} rounds: ${JSON.stringify(counts())}`,
    )
  await collectUntil({ matches, deadline, rounds: rounds + 1 })
}

if (isMainThread) {
  const clip = process.argv[2]
  const mode = process.argv[3]
  if (!clip || !isCleanupMode(mode)) throw new Error('Missing cleanup-test fixture or mode')
  assert.deepEqual(counts(), { owners: 0, callbacks: 0, handles: 0 })
  // Keep this environment's addon loaded so its process-wide counters outlive
  // each worker's N-API environment, including discarded TSFN callbacks.
  await Array.from({ length: 3 }).reduce(async (previous) => {
    await previous
    const worker = new Worker(new URL(import.meta.url), {
      execArgv: ['--import', 'tsx'],
      workerData: { clip, mode },
    })
    const code = await new Promise<number>((resolveExit, reject) => {
      worker.once('error', reject)
      worker.once('exit', resolveExit)
    })
    assert.equal(code, 0)
    assert.deepEqual(counts(), { owners: 0, callbacks: 0, handles: 0 })
  }, Promise.resolve())
} else {
  const data: unknown = workerData
  if (!isRecord(data) || typeof data.clip !== 'string' || !isCleanupMode(data.mode))
    throw new Error('Invalid cleanup worker data')
  const { clip, mode } = data
  await (async () => {
    const players = Array.from({ length: 8 }, () => {
      const player: unknown = create({ kind: MPV_SURFACE_KINDS.headless }, ignoreEvent)
      if (!isHandle(player)) throw new Error('Invalid native cleanup-test handle')
      player.observe(MPV_PROPERTIES.pause)
      player.observe(MPV_PROPERTIES.timePos)
      player.command(1, [MPV_COMMANDS.loadfile, clip])
      Array.from({ length: 32 }).forEach((_value, index) => {
        player.set(index + 2, MPV_PROPERTIES.pause, index % 2 === 0)
      })
      return player
    })
    if (mode === CLEANUP_MODES.explicit)
      await Promise.all(players.map((player) => player.destroy()))
    // GC/environment modes intentionally abandon engines with wakeups in flight.
  })()
  if (mode === CLEANUP_MODES.explicit) {
    await collectUntil({ matches: () => counts().owners === 0 && counts().callbacks === 0 })
    assert.equal(counts().handles, 0)
  }
  if (mode === CLEANUP_MODES.gc) {
    await collectUntil({ matches: () => counts().handles === 0 })
    // The async cleanup hook intentionally retains abandoned owners until exit.
    // The parent verifies those owners and their TSFNs are then reclaimed too.
  }
  process.exit(0)
}
