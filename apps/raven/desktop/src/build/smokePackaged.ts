import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PACKAGED_APP } from '@/build/bundleAudit'
import { versionOf } from '@/build/dmgMaker'
import {
  logLinesSince,
  SMOKE_QUIT_MS,
  SMOKE_STAGES,
  SMOKE_START_MS,
  type SmokeStage,
  smokeGaps,
  withoutTestHooks,
} from '@/build/smokeVerdict'
import { LOG_FILE } from '@/main/log/log'
import { logsDirFor } from '@/main/log/opens'
import { ERROR_CODES } from '@/main/stateStore'

const POLL_MS = 250
const RUNNING_PATTERN = 'raven player.app/Contents/MacOS/raven player'
const MARKS = ['raven-launch-ms ', 'raven-quit-ms '] as const

const execFileAsync = promisify(execFile)
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === ERROR_CODES.enoent

const sizeOf = async ({ path }: { path: string }): Promise<number> => {
  try {
    return (await stat(path)).size
  } catch (error) {
    if (isMissing(error)) return 0
    throw error
  }
}

/** pgrep exits 1 when nothing matches, which is the answer the smoke wants. */
const isRavenRunning = async (): Promise<boolean> => {
  try {
    await execFileAsync('pgrep', ['-f', RUNNING_PATTERN])
    return true
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 1) {
      return false
    }
    throw error
  }
}

const bytesOf = async ({ path }: { path: string }): Promise<Uint8Array | null> => {
  try {
    return await readFile(path)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

/** The lines written after `from`, the rotated file's included when the log rotated meanwhile. */
const linesAfter = async ({ path, from }: { path: string; from: number }): Promise<string[]> => {
  const live = await bytesOf({ path })
  if (live === null) return []
  const rotated = live.length < from ? await bytesOf({ path: `${path}.1` }) : null
  return logLinesSince({ live, rotated, from })
}

const waitUntil = async ({
  isDone,
  deadline,
}: {
  isDone: () => Promise<boolean>
  deadline: number
}): Promise<boolean> => {
  if (await isDone()) return true
  if (Date.now() >= deadline) return false
  await sleep(POLL_MS)
  return waitUntil({ isDone, deadline })
}

const smoke = async ({ project }: { project: string }): Promise<number> => {
  const app = join(project, PACKAGED_APP)
  if (!existsSync(app)) {
    console.error('Run bunx nx run @raven/desktop:make first.')
    return 1
  }
  if (await isRavenRunning()) {
    console.error('Quit raven player first: the smoke launches its own and reads its log.')
    return 1
  }
  const version = versionOf(JSON.parse(await readFile(join(project, 'package.json'), 'utf8')))
  const logPath = join(logsDirFor({ home: homedir(), userDataOverride: null }), LOG_FILE)
  const from = await sizeOf({ path: logPath })
  const child = spawn(join(app, 'Contents', 'MacOS', 'raven player'), [], {
    env: withoutTestHooks({ env: process.env }),
    stdio: 'ignore',
  })
  const lifecycle = { hasExited: false }
  child.on('exit', () => {
    lifecycle.hasExited = true
  })
  // A spawn that fails emits only `error`, which would otherwise end the smoke uncaught.
  child.on('error', (error) => {
    console.error(`raven player did not start: ${error.message}`)
    lifecycle.hasExited = true
  })
  const state = { lines: new Array<string>() }
  const gapsFor = async ({ stage }: { stage: SmokeStage }) => {
    state.lines = await linesAfter({ path: logPath, from })
    return smokeGaps({ lines: state.lines, stage, version })
  }
  const fail = ({ stage, why }: { stage: SmokeStage; why: string[] }): number => {
    console.error(`raven player failed the packaged smoke at the ${stage} stage. Missing:`)
    why.forEach((gap) => console.error(`  ${gap}`))
    console.error('New log lines:')
    state.lines.forEach((line) => console.error(`  ${line}`))
    return 1
  }

  // Killed here whether the smoke passed, failed or threw, so no app outlives it.
  try {
    const hasStarted = await waitUntil({
      isDone: async () =>
        (await gapsFor({ stage: SMOKE_STAGES.started })).length === 0 || lifecycle.hasExited,
      deadline: Date.now() + SMOKE_START_MS,
    })
    const startGaps = await gapsFor({ stage: SMOKE_STAGES.started })
    if (!hasStarted || startGaps.length > 0) {
      return fail({
        stage: SMOKE_STAGES.started,
        why: lifecycle.hasExited
          ? [...startGaps, 'raven player exited by itself before SIGTERM']
          : startGaps,
      })
    }

    child.kill('SIGTERM')
    await waitUntil({
      isDone: async () =>
        lifecycle.hasExited && (await gapsFor({ stage: SMOKE_STAGES.quit })).length === 0,
      deadline: Date.now() + SMOKE_QUIT_MS,
    })
    const quitGaps = await gapsFor({ stage: SMOKE_STAGES.quit })
    if (!lifecycle.hasExited || quitGaps.length > 0) {
      return fail({
        stage: SMOKE_STAGES.quit,
        why: lifecycle.hasExited
          ? quitGaps
          : [...quitGaps, `an exit within ${SMOKE_QUIT_MS} ms of SIGTERM`],
      })
    }
    state.lines
      .filter((line) => MARKS.some((needle) => line.includes(needle)))
      .forEach((line) => process.stdout.write(`${line}\n`))
    process.stdout.write(
      `raven player ${version} launched, opened its video engine and quit on SIGTERM.\n`,
    )
    return 0
  } finally {
    if (!lifecycle.hasExited) child.kill('SIGKILL')
  }
}

if (import.meta.main) {
  process.exitCode = await smoke({ project: join(import.meta.dirname, '..', '..') })
}
