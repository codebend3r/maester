import { describe, expect, it } from 'bun:test'
import { DESKTOP_PLATFORMS, type DesktopPlatform } from '@raven/core'
import {
  SQUIRREL_EVENTS,
  SQUIRREL_STEP_KINDS,
  type SquirrelStep,
  squirrelStepFor,
  takeSquirrelStep,
} from '@/main/squirrel'

const EXE = 'C:\\Users\\a\\AppData\\Local\\raven\\app-0.7.5\\Raven.exe'
const UPDATE = 'C:\\Users\\a\\AppData\\Local\\raven\\Update.exe'

type StepProps = { flag: string; platform?: DesktopPlatform }

const step = ({ flag, platform = DESKTOP_PLATFORMS.windows }: StepProps) =>
  squirrelStepFor({ platform, argv: [EXE, flag, '0.7.5'], execPath: EXE })

describe('squirrelStepFor', () => {
  it('makes the shortcuts with Update.exe on install and on update', () => {
    const create = {
      kind: SQUIRREL_STEP_KINDS.run,
      command: UPDATE,
      args: ['--createShortcut=Raven.exe'],
    }
    expect(step({ flag: SQUIRREL_EVENTS.install })).toEqual(create)
    expect(step({ flag: SQUIRREL_EVENTS.updated })).toEqual(create)
  })

  it('removes the shortcuts on uninstall', () => {
    expect(step({ flag: SQUIRREL_EVENTS.uninstall })).toEqual({
      kind: SQUIRREL_STEP_KINDS.run,
      command: UPDATE,
      args: ['--removeShortcut=Raven.exe'],
    })
  })

  it('only quits when Squirrel says the version is obsolete', () => {
    expect(step({ flag: SQUIRREL_EVENTS.obsolete })).toEqual({ kind: SQUIRREL_STEP_KINDS.quit })
  })

  it('launches as usual on the first run after an install, on a file and with no flag', () => {
    expect(step({ flag: '--squirrel-firstrun' })).toEqual({ kind: SQUIRREL_STEP_KINDS.launch })
    expect(step({ flag: 'C:\\Videos\\clip.mkv' })).toEqual({ kind: SQUIRREL_STEP_KINDS.launch })
    expect(
      squirrelStepFor({ platform: DESKTOP_PLATFORMS.windows, argv: [EXE], execPath: EXE }),
    ).toEqual({ kind: SQUIRREL_STEP_KINDS.launch })
  })

  it('reads the flag only right after the executable', () => {
    expect(
      squirrelStepFor({
        platform: DESKTOP_PLATFORMS.windows,
        argv: [EXE, 'C:\\Videos\\clip.mkv', SQUIRREL_EVENTS.install],
        execPath: EXE,
      }),
    ).toEqual({ kind: SQUIRREL_STEP_KINDS.launch })
  })

  it('launches as usual on macOS, whatever the arguments', () => {
    expect(step({ flag: SQUIRREL_EVENTS.install, platform: DESKTOP_PLATFORMS.mac })).toEqual({
      kind: SQUIRREL_STEP_KINDS.launch,
    })
  })
})

type TakeProps = { step: SquirrelStep }

const take = ({ step: taken }: TakeProps) => {
  const calls: string[] = []
  const pending = { done: () => {} }
  const isLaunch = takeSquirrelStep({
    step: taken,
    run: ({ command, args, done }) => {
      calls.push(`run ${command} ${args.join(' ')}`)
      pending.done = done
    },
    quit: () => {
      calls.push('quit')
    },
  })
  return { isLaunch, calls, finish: () => pending.done() }
}

describe('takeSquirrelStep', () => {
  it('opens the app as usual on a launch, running and quitting nothing', () => {
    const { isLaunch, calls } = take({ step: { kind: SQUIRREL_STEP_KINDS.launch } })
    expect(isLaunch).toBe(true)
    expect(calls).toEqual([])
  })

  it('quits at once on a step with nothing to run', () => {
    const { isLaunch, calls } = take({ step: { kind: SQUIRREL_STEP_KINDS.quit } })
    expect(isLaunch).toBe(false)
    expect(calls).toEqual(['quit'])
  })

  it('quits only once Update.exe is done', () => {
    const { isLaunch, calls, finish } = take({
      step: {
        kind: SQUIRREL_STEP_KINDS.run,
        command: UPDATE,
        args: ['--createShortcut=Raven.exe'],
      },
    })
    expect(isLaunch).toBe(false)
    expect(calls).toEqual([`run ${UPDATE} --createShortcut=Raven.exe`])
    finish()
    expect(calls).toEqual([`run ${UPDATE} --createShortcut=Raven.exe`, 'quit'])
  })
})
