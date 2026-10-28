import { join } from 'node:path'
import { DESKTOP_PLATFORMS, type DesktopPlatform } from '@raven/core'
import { PACKAGED_APP, WINDOWS_APP, WINDOWS_EXE } from '@/build/bundleAudit'
import { logsDirFor } from '@/main/log/opens'
import { WEB_HOST_READY } from '@/main/webHost'

export const SMOKE_START_MS = 30_000
export const SMOKE_QUIT_MS = 5_000

export const SMOKE_STAGES = { started: 'started', quit: 'quit' } as const
export type SmokeStage = (typeof SMOKE_STAGES)[keyof typeof SMOKE_STAGES]

const ENGINE_READY = 'video engine ready: mpv v'
const ENGINE_FAILED = 'could not open its video engine'
const LAUNCH_MARK = 'raven-launch-ms '
const QUIT_MARK = 'raven-quit-ms '
const TEST_HOOK_PREFIX = 'RAVEN_DESKTOP_'

type NeedlesForProps = { stage: SmokeStage; version: string }

const needlesFor = ({ stage, version }: NeedlesForProps): string[] => {
  const started = [`launch Raven ${version} (packaged)`, WEB_HOST_READY, ENGINE_READY, LAUNCH_MARK]
  switch (stage) {
    case SMOKE_STAGES.started:
      return started
    case SMOKE_STAGES.quit:
      return [...started, QUIT_MARK]
    default: {
      const unreachable: never = stage
      return unreachable
    }
  }
}

type SmokeGapsProps = {
  lines: readonly string[]
  stage: SmokeStage
  version: string
}

/** The needles the new log lines still lack for a stage, in order: [] when the stage passed. */
export const smokeGaps = ({ lines, stage, version }: SmokeGapsProps): string[] => {
  const failure = lines.find((line) => line.includes(ENGINE_FAILED)) ?? null
  return needlesFor({ stage, version })
    .filter((needle) => !lines.some((line) => line.includes(needle)))
    .map((needle) =>
      needle === ENGINE_READY && failure !== null
        ? `the video engine did not open: ${failure}`
        : needle,
    )
}

type WithoutTestHooksProps = {
  env: Readonly<Record<string, string | undefined>>
}

/** The environment a person launches with: a packaged app reads no test hook, and the smoke passes none. */
export const withoutTestHooks = ({ env }: WithoutTestHooksProps): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).flatMap(([name, value]) =>
      value === undefined || name.startsWith(TEST_HOOK_PREFIX) ? [] : [[name, value]],
    ),
  )

const linesOf = (bytes: Uint8Array): string[] =>
  new TextDecoder()
    .decode(bytes)
    .split('\n')
    .filter((line) => line.length > 0)

type LogLinesSinceProps = {
  live: Uint8Array
  rotated: Uint8Array | null
  from: number
}

/**
 * The log lines written since the live log was `from` bytes long. A live log shorter than
 * that rotated meanwhile: its old bytes moved to the first rotated file, whose rest came
 * before the new live log.
 */
export const logLinesSince = ({ live, rotated, from }: LogLinesSinceProps): string[] => {
  if (live.length >= from) return linesOf(live.subarray(from))
  return [...linesOf(rotated?.subarray(from) ?? new Uint8Array()), ...linesOf(live)]
}

/**
 * How the smoke asks Raven to quit, as the failures name it. macOS sends SIGTERM, which
 * Electron answers with `app.quit()`. Windows delivers no signal to a GUI app: Node's
 * `child.kill()` ends it at once through TerminateProcess, so it could never log its quit.
 * `taskkill` without `/F` posts WM_CLOSE to its window instead, which closes the window,
 * and closing Raven's one window quits it as a person would.
 */
export const SMOKE_STOP_NAMES = {
  [DESKTOP_PLATFORMS.mac]: 'SIGTERM',
  [DESKTOP_PLATFORMS.windows]: 'WM_CLOSE',
} as const satisfies Record<DesktopPlatform, string>

/** The folder Electron's userData sits in, `%APPDATA%` on Windows. */
const RAVEN_DATA = 'raven'

type SmokePathsForProps = {
  platform: DesktopPlatform
  project: string
  home: string
  /** `%APPDATA%`, which Windows sets; unused on macOS. */
  appData: string | undefined
}

/** The packaged app to look for, the executable to launch and the folder its log goes to. */
export const smokePathsFor = ({ platform, project, home, appData }: SmokePathsForProps) => {
  switch (platform) {
    case DESKTOP_PLATFORMS.mac: {
      const app = join(project, PACKAGED_APP)
      return {
        app,
        executable: join(app, 'Contents', 'MacOS', 'Raven'),
        logsDir: logsDirFor({
          platform,
          home,
          userData: join(home, 'Library', 'Application Support', RAVEN_DATA),
          hasUserDataOverride: false,
        }),
      }
    }
    case DESKTOP_PLATFORMS.windows: {
      const app = join(project, WINDOWS_APP)
      return {
        app,
        executable: join(app, WINDOWS_EXE),
        logsDir: logsDirFor({
          platform,
          home,
          userData: join(appData ?? join(home, 'AppData', 'Roaming'), RAVEN_DATA),
          hasUserDataOverride: false,
        }),
      }
    }
    default: {
      const unreachable: never = platform
      return unreachable
    }
  }
}

/** What `tasklist /FO CSV /NH` prints a process's line with: its image name, quoted. */
const RAVEN_TASK = `"${WINDOWS_EXE}",`

/** Whether `tasklist /FO CSV /NH` lists a Raven; with none it prints only an INFO line. */
export const isRavenListed = (tasklist: string): boolean =>
  tasklist
    .split(/\r?\n/)
    .some((line) => line.trim().toLowerCase().startsWith(RAVEN_TASK.toLowerCase()))
