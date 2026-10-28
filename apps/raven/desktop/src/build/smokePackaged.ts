import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { DESKTOP_PLATFORMS, type DesktopPlatform, desktopPlatformFor } from '@raven/core'
import { WINDOWS_EXE } from '@/build/bundleAudit'
import { versionOf } from '@/build/dmgMaker'
import {
  isRavenListed,
  logLinesSince,
  SMOKE_QUIT_MS,
  SMOKE_STAGES,
  SMOKE_START_MS,
  SMOKE_STOP_NAMES,
  type SmokeStage,
  smokeGaps,
  smokePathsFor,
  withoutTestHooks,
} from '@/build/smokeVerdict'
import { LOG_FILE } from '@/main/log/log'
import { isMissingFile } from '@/main/stateStore'

const POLL_MS = 250
const RUNNING_PATTERN = 'Raven.app/Contents/MacOS/Raven'
const MARKS = ['raven-launch-ms ', 'raven-quit-ms '] as const
const ENV_NAMES = { appData: 'APPDATA' } as const

const execFileAsync = promisify(execFile)
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type SizeOfProps = { path: string }

const sizeOf = async ({ path }: SizeOfProps): Promise<number> => {
  try {
    return (await stat(path)).size
  } catch (error) {
    if (isMissingFile(error)) return 0
    throw error
  }
}

/** pgrep exits 1 when nothing matches, which is the answer the smoke wants. */
const isRavenRunningOnMac = async (): Promise<boolean> => {
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

const isRavenRunningOnWindows = async (): Promise<boolean> => {
  const { stdout } = await execFileAsync('tasklist', [
    '/FI',
    `IMAGENAME eq ${WINDOWS_EXE}`,
    '/FO',
    'CSV',
    '/NH',
  ])
  return isRavenListed(stdout)
}

type StopProps = { child: ChildProcess }

/** How the smoke finds a running Raven, and asks the one it launched to quit as SMOKE_STOP_NAMES says. */
type SmokeHost = {
  isRavenRunning: () => Promise<boolean>
  stop: (props: StopProps) => Promise<void>
}

const HOSTS = {
  [DESKTOP_PLATFORMS.mac]: {
    isRavenRunning: isRavenRunningOnMac,
    stop: async ({ child }) => {
      child.kill('SIGTERM')
    },
  },
  [DESKTOP_PLATFORMS.windows]: {
    isRavenRunning: isRavenRunningOnWindows,
    stop: async ({ child }) => {
      if (child.pid === undefined) return
      // A refusal is reported here; the quit stage then fails on the exit that never came.
      await execFileAsync('taskkill', ['/PID', String(child.pid)]).catch((error: unknown) => {
        console.error(`taskkill could not ask Raven to close: ${String(error)}`)
      })
    },
  },
} as const satisfies Record<DesktopPlatform, SmokeHost>

type BytesOfProps = { path: string }

const bytesOf = async ({ path }: BytesOfProps): Promise<Uint8Array | null> => {
  try {
    return await readFile(path)
  } catch (error) {
    if (isMissingFile(error)) return null
    throw error
  }
}

type LinesAfterProps = { path: string; from: number }

/** The lines written after `from`, the rotated file's included when the log rotated meanwhile. */
const linesAfter = async ({ path, from }: LinesAfterProps): Promise<string[]> => {
  const live = await bytesOf({ path })
  if (live === null) return []
  const rotated = live.length < from ? await bytesOf({ path: `${path}.1` }) : null
  return logLinesSince({ live, rotated, from })
}

type WaitUntilProps = {
  isDone: () => Promise<boolean>
  deadline: number
}

const waitUntil = async ({ isDone, deadline }: WaitUntilProps): Promise<boolean> => {
  if (await isDone()) return true
  if (Date.now() >= deadline) return false
  await sleep(POLL_MS)
  return waitUntil({ isDone, deadline })
}

type SmokeProps = { project: string; platform: DesktopPlatform }

const smoke = async ({ project, platform }: SmokeProps): Promise<number> => {
  const host = HOSTS[platform]
  const stopName = SMOKE_STOP_NAMES[platform]
  const { app, executable, logsDir } = smokePathsFor({
    platform,
    project,
    home: homedir(),
    appData: process.env[ENV_NAMES.appData],
  })
  if (!existsSync(app)) {
    console.error('Run bunx nx run @raven/desktop:make first.')
    return 1
  }
  if (await host.isRavenRunning()) {
    console.error('Quit Raven first: the smoke launches its own and reads its log.')
    return 1
  }
  const version = versionOf(JSON.parse(await readFile(join(project, 'package.json'), 'utf8')))
  const logPath = join(logsDir, LOG_FILE)
  const from = await sizeOf({ path: logPath })
  const child = spawn(executable, [], {
    env: withoutTestHooks({ env: process.env }),
    stdio: 'ignore',
  })
  const lifecycle = { hasExited: false }
  child.on('exit', () => {
    lifecycle.hasExited = true
  })
  // A spawn that fails emits only `error`, which would otherwise end the smoke uncaught.
  child.on('error', (error) => {
    console.error(`Raven did not start: ${error.message}`)
    lifecycle.hasExited = true
  })
  const state = { lines: new Array<string>() }
  type GapsForProps = { stage: SmokeStage }

  const gapsFor = async ({ stage }: GapsForProps) => {
    state.lines = await linesAfter({ path: logPath, from })
    return smokeGaps({ lines: state.lines, stage, version })
  }
  type FailProps = { stage: SmokeStage; why: string[] }

  const fail = ({ stage, why }: FailProps): number => {
    console.error(`Raven failed the packaged smoke at the ${stage} stage. Missing:`)
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
          ? [...startGaps, `Raven exited by itself before ${stopName}`]
          : startGaps,
      })
    }

    await host.stop({ child })
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
          : [...quitGaps, `an exit within ${SMOKE_QUIT_MS} ms of ${stopName}`],
      })
    }
    state.lines
      .filter((line) => MARKS.some((needle) => line.includes(needle)))
      .forEach((line) => process.stdout.write(`${line}\n`))
    process.stdout.write(
      `Raven ${version} launched, served its page, opened its video engine and quit on ${stopName}.\n`,
    )
    return 0
  } finally {
    if (!lifecycle.hasExited) child.kill('SIGKILL')
  }
}

if (import.meta.main) {
  process.exitCode = await smoke({
    project: join(import.meta.dirname, '..', '..'),
    platform: desktopPlatformFor({ platform: process.platform }),
  })
}
