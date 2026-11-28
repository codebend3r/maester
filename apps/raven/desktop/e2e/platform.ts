import { type ChildProcess, execFile } from 'node:child_process'
import { chmod, mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DESKTOP_PLATFORMS, type DesktopPlatform } from '@raven/core'
import { type NativeTarget, nativeTargetOf } from '@raven/mpv'
import { desktopPlatformFor } from '@/shared/platform'

/** The system the suite runs on, which is the one the app it launches runs on. */
export const E2E_PLATFORM = desktopPlatformFor({ platform: process.platform })

/** The native build the launched app loads, as main names it; throws where raven has none. */
export const e2eTarget = (): NativeTarget => {
  const target = nativeTargetOf({ platform: process.platform, arch: process.arch })
  if (target === null) {
    throw new Error(`raven has no native build for ${process.platform} ${process.arch}.`)
  }
  return target
}

type Tool = { command: string; args: string[] }

/** Runs a system tool to its end, failing with what it printed. */
const runTool = ({ command, args }: Tool): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error === null) return resolve()
      const printed = `${stderr}${stdout}`.trim()
      reject(new Error(`${command} failed: ${printed === '' ? error.message : printed}`))
    })
  })

type PidProps = { pid: number }

type ChildProps = { child: ChildProcess }

/** What the suite does its own way on each system. */
type E2eSystem = {
  /**
   * ffmpeg's H.264 encoder for the clips, at the same bitrate on both. VideoToolbox exists only
   * on macOS, where `-allow_sw 1` lets it fall back to its software encoder on a runner without
   * a hardware one. Windows encodes with libx264, which a full ffmpeg build carries. ffmpeg
   * hands VideoToolbox a keyframe every 12 frames by default and libx264 one every 250, so
   * `-g 12` keeps a seek on Windows landing as near as it does on macOS.
   */
  videoEncoder: readonly string[]
  /**
   * How often removing a folder is tried again. Windows refuses to remove a file a process
   * still holds open, and Electron's helpers let go of the profile a moment after the app's
   * process ends. Node waits 250 ms longer before each try, so 8 can take 9 seconds in all.
   */
  removeRetries: number
  /**
   * Whether a file's mode says who may read it. Windows keeps no owner, group and other bits:
   * Node reports every file there as readable by all, and the profile's own access rules keep
   * the log to its user.
   */
  hasFileModes: boolean
  /**
   * The temp folder's path as main would resolve it. A Windows runner's is handed out in its
   * 8.3 short form (`RUNNER~1`), which no path main resolves ever carries, so a test looking
   * for a folder in the log would look for a name that could not be there. macOS's is used as
   * it is given.
   */
  resolveTemp: (folder: string) => Promise<string>
  /**
   * Makes a file one that can be found and measured but not read, so only opening it fails.
   * macOS takes every permission bit away. Windows' `chmod` can only set the read-only flag, so
   * there an access rule denies everyone the file's data (`RD`) and nothing else: its
   * attributes still read, which is all a stat needs.
   */
  denyReading: (path: string) => Promise<void>
  /**
   * What lists a process's children, one pid to a line. `pgrep` exits 1, with no output, when
   * there are none. Windows has no `pgrep`, so PowerShell asks CIM for the processes whose
   * parent it is; the filter is in single quotes, so the command holds no quote for Windows to
   * escape.
   */
  listChildren: (input: PidProps) => Tool
  /**
   * Ends an app that would not quit. SIGKILL takes Electron's helpers with it on macOS, which
   * end when their parent does; on Windows it ends only the one process, and a helper left
   * behind would keep the profile's files open, so `taskkill` ends the whole tree.
   */
  forceEnd: (input: ChildProps) => Promise<void>
  /**
   * The most a launch's median may take, from main's first line to ready-to-show: twice the
   * 800 ms cold launch budget (spec section 8) on a Mac, three times it on a Windows runner,
   * whose launches measured 1,660 to 1,830 ms there.
   */
  launchLimitMs: number
  /**
   * Whether mpv's warnings name a download it cannot read, so the log shows `<file>` in its
   * place. On the Windows runner they named no file at all, so only the leak check applies.
   */
  isRefusedFileNamed: boolean
}

/** Everyone, by its well-known SID, so the rule does not depend on the system's language. */
const EVERYONE = '*S-1-1-0'

const SYSTEMS = {
  [DESKTOP_PLATFORMS.mac]: {
    videoEncoder: ['-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-b:v', '1M'],
    removeRetries: 0,
    hasFileModes: true,
    resolveTemp: (folder) => Promise.resolve(folder),
    denyReading: (path) => chmod(path, 0o000),
    listChildren: ({ pid }) => ({ command: 'pgrep', args: ['-P', `${pid}`] }),
    forceEnd: async ({ child }) => {
      child.kill('SIGKILL')
    },
    launchLimitMs: 1600,
    isRefusedFileNamed: true,
  },
  [DESKTOP_PLATFORMS.windows]: {
    videoEncoder: ['-c:v', 'libx264', '-preset', 'veryfast', '-g', '12', '-b:v', '1M'],
    removeRetries: 8,
    hasFileModes: false,
    resolveTemp: (folder) => realpath(folder),
    denyReading: (path) =>
      runTool({ command: 'icacls', args: [path, '/deny', `${EVERYONE}:(RD)`] }),
    listChildren: ({ pid }) => ({
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${pid}' | ForEach-Object { $_.ProcessId }`,
      ],
    }),
    forceEnd: async ({ child: { pid } }) => {
      if (pid === undefined) return
      // It fails when the app ended meanwhile, which is the end this wanted.
      await runTool({ command: 'taskkill', args: ['/PID', `${pid}`, '/T', '/F'] }).catch(
        () => undefined,
      )
    },
    launchLimitMs: 2400,
    isRefusedFileNamed: false,
  },
} as const satisfies Record<DesktopPlatform, E2eSystem>

/** How the suite does those things on the system it runs on. */
export const E2E_SYSTEM: E2eSystem = SYSTEMS[E2E_PLATFORM]

/** A fresh folder under the system's temp folder, named from `prefix`. */
export const makeTempDir = async (prefix: string): Promise<string> =>
  E2E_SYSTEM.resolveTemp(await mkdtemp(join(tmpdir(), prefix)))
