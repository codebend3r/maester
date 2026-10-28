import { win32 } from 'node:path'
import { DESKTOP_PLATFORMS, type DesktopPlatform } from '@raven/core'

/**
 * Squirrel.Windows, which installs Raven, runs it with one of these flags on each install
 * event and waits for it to exit. `--squirrel-firstrun`, the launch after an install, is not
 * among them: that one opens Raven as usual.
 */
export const SQUIRREL_EVENTS = {
  install: '--squirrel-install',
  updated: '--squirrel-updated',
  uninstall: '--squirrel-uninstall',
  obsolete: '--squirrel-obsolete',
} as const

type SquirrelEvent = (typeof SQUIRREL_EVENTS)[keyof typeof SQUIRREL_EVENTS]

const isSquirrelEvent = (value: unknown): value is SquirrelEvent =>
  Object.values(SQUIRREL_EVENTS).some((event) => event === value)

export const SQUIRREL_STEP_KINDS = { launch: 'launch', quit: 'quit', run: 'run' } as const

/** What the app does first: open as usual, quit, or run Squirrel's `Update.exe` and then quit. */
export type SquirrelStep =
  | { kind: typeof SQUIRREL_STEP_KINDS.launch }
  | { kind: typeof SQUIRREL_STEP_KINDS.quit }
  | { kind: typeof SQUIRREL_STEP_KINDS.run; command: string; args: string[] }

const UPDATE_EXE = 'Update.exe'
const SHORTCUT_FLAGS = { create: '--createShortcut', remove: '--removeShortcut' } as const

type ShortcutFlag = (typeof SHORTCUT_FLAGS)[keyof typeof SHORTCUT_FLAGS]

type SquirrelStepForProps = {
  platform: DesktopPlatform
  /** The process's argv: Squirrel puts its flag right after the executable. */
  argv: readonly string[]
  /** The running `Raven.exe`, in the version folder beside Squirrel's `Update.exe`. */
  execPath: string
}

/**
 * The step for this launch. Installing and updating make the Start menu and desktop
 * shortcuts, uninstalling removes them, and an obsolete version only quits. The paths are
 * Windows', whatever system the tests run on.
 */
export const squirrelStepFor = ({
  platform,
  argv,
  execPath,
}: SquirrelStepForProps): SquirrelStep => {
  const flag = argv[1] ?? null
  if (platform !== DESKTOP_PLATFORMS.windows || !isSquirrelEvent(flag)) {
    return { kind: SQUIRREL_STEP_KINDS.launch }
  }
  const command = win32.resolve(win32.dirname(execPath), '..', UPDATE_EXE)
  const shortcut = (action: ShortcutFlag): SquirrelStep => ({
    kind: SQUIRREL_STEP_KINDS.run,
    command,
    args: [`${action}=${win32.basename(execPath)}`],
  })
  switch (flag) {
    case SQUIRREL_EVENTS.install:
    case SQUIRREL_EVENTS.updated:
      return shortcut(SHORTCUT_FLAGS.create)
    case SQUIRREL_EVENTS.uninstall:
      return shortcut(SHORTCUT_FLAGS.remove)
    case SQUIRREL_EVENTS.obsolete:
      return { kind: SQUIRREL_STEP_KINDS.quit }
    default: {
      const unreachable: never = flag
      return unreachable
    }
  }
}

type RunProps = { command: string; args: string[]; done: () => void }

type TakeSquirrelStepProps = {
  step: SquirrelStep
  /** Starts the command and calls `done` once it ends or fails to start. */
  run: (props: RunProps) => void
  quit: () => void
}

/**
 * Takes the step: true when the app should open as usual. Otherwise it quits, once
 * `Update.exe` is done with the shortcuts when there is a command to run.
 */
export const takeSquirrelStep = ({ step, run, quit }: TakeSquirrelStepProps): boolean => {
  switch (step.kind) {
    case SQUIRREL_STEP_KINDS.launch:
      return true
    case SQUIRREL_STEP_KINDS.quit:
      quit()
      return false
    case SQUIRREL_STEP_KINDS.run:
      run({ command: step.command, args: step.args, done: quit })
      return false
    default: {
      const unreachable: never = step
      return unreachable
    }
  }
}
