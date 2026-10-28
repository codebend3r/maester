import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { DESKTOP_PLATFORMS } from '@raven/core'
import {
  isRavenListed,
  logLinesSince,
  SMOKE_STAGES,
  SMOKE_STOP_NAMES,
  smokeGaps,
  smokePathsFor,
  withoutTestHooks,
} from '@/build/smokeVerdict'

const LAUNCH =
  '2026-10-16T12:00:00.000Z info launch Raven 0.5.4 (packaged), Electron 44.7.0, macOS 27.0.0'
const WEB_HOST =
  '2026-10-16T12:00:00.300Z info web host ready at http://localhost:47484, /api goes to https://raven.example'
const ENGINE = '2026-10-16T12:00:00.400Z info video engine ready: mpv v0.41.0, FFmpeg 8.0'
const LAUNCH_MARK = '2026-10-16T12:00:00.500Z info raven-launch-ms 812'
const QUIT_MARK = '2026-10-16T12:00:02.000Z info raven-quit-ms 140'
const STARTED = [LAUNCH, WEB_HOST, ENGINE, LAUNCH_MARK]

describe('smokeGaps', () => {
  it('passes the started stage on the launch, web host, engine and launch mark lines', () => {
    expect(smokeGaps({ lines: STARTED, stage: SMOKE_STAGES.started, version: '0.5.4' })).toEqual([])
  })

  it('still wants the quit mark for the quit stage', () => {
    expect(smokeGaps({ lines: STARTED, stage: SMOKE_STAGES.quit, version: '0.5.4' })).toEqual([
      'raven-quit-ms ',
    ])
  })

  it('wants the packaged launch line', () => {
    const lines = [LAUNCH.replace('(packaged)', '(unpackaged)'), WEB_HOST, ENGINE, LAUNCH_MARK]
    expect(smokeGaps({ lines, stage: SMOKE_STAGES.started, version: '0.5.4' })).toEqual([
      'launch Raven 0.5.4 (packaged)',
    ])
  })

  it('wants the version package.json names', () => {
    expect(smokeGaps({ lines: STARTED, stage: SMOKE_STAGES.started, version: '0.5.5' })).toEqual([
      'launch Raven 0.5.5 (packaged)',
    ])
  })

  it('says why the video engine did not open', () => {
    const failure = '2026-10-16T12:00:00.400Z warn Raven could not open its video engine: no addon'
    expect(
      smokeGaps({
        lines: [LAUNCH, WEB_HOST, failure, LAUNCH_MARK],
        stage: SMOKE_STAGES.started,
        version: '0.5.4',
      }),
    ).toEqual([`the video engine did not open: ${failure}`])
  })

  it('wants the web host, which the window loads its page from', () => {
    expect(
      smokeGaps({
        lines: [LAUNCH, ENGINE, LAUNCH_MARK],
        stage: SMOKE_STAGES.started,
        version: '0.5.4',
      }),
    ).toEqual(['web host ready'])
  })

  it('passes the quit stage on all five lines', () => {
    expect(
      smokeGaps({ lines: [...STARTED, QUIT_MARK], stage: SMOKE_STAGES.quit, version: '0.5.4' }),
    ).toEqual([])
  })

  it('names every needle of an empty log, in order', () => {
    expect(smokeGaps({ lines: [], stage: SMOKE_STAGES.quit, version: '0.5.4' })).toEqual([
      'launch Raven 0.5.4 (packaged)',
      'web host ready',
      'video engine ready: mpv v',
      'raven-launch-ms ',
      'raven-quit-ms ',
    ])
  })
})

describe('withoutTestHooks', () => {
  it('drops every RAVEN_DESKTOP_ variable and keeps the rest', () => {
    expect(
      withoutTestHooks({
        env: {
          HOME: '/Users/a',
          RAVEN_DESKTOP_USER_DATA: '/tmp/x',
          RAVEN_DESKTOP_MPV: 'off',
          RAVEN_SIGN_IDENTITY: undefined,
          PATH: '/usr/bin',
        },
      }),
    ).toEqual({ HOME: '/Users/a', PATH: '/usr/bin' })
  })
})

describe('logLinesSince', () => {
  const bytes = (text: string) => new TextEncoder().encode(text)
  const OLD = 'old 1\nold 2\n'

  it('reads the live log from where it was when the smoke began', () => {
    expect(
      logLinesSince({ live: bytes(`${OLD}new 1\nnew 2\n`), rotated: null, from: OLD.length }),
    ).toEqual(['new 1', 'new 2'])
  })

  it('reads the rotated file from that point, then the whole new live log, once it shrank', () => {
    expect(
      logLinesSince({
        live: bytes('new 2\n'),
        rotated: bytes(`${OLD}new 1\n`),
        from: OLD.length,
      }),
    ).toEqual(['new 1', 'new 2'])
  })

  it('reads the whole live log when it shrank and there is no rotated file', () => {
    expect(logLinesSince({ live: bytes('new 2\n'), rotated: null, from: OLD.length })).toEqual([
      'new 2',
    ])
  })

  it('reads nothing when nothing was written', () => {
    expect(logLinesSince({ live: bytes(OLD), rotated: null, from: OLD.length })).toEqual([])
  })
})

describe('smokePathsFor', () => {
  const project = '/repo/apps/raven/desktop'

  it("launches the app bundle's executable and reads the pinned macOS logs folder", () => {
    expect(
      smokePathsFor({
        platform: DESKTOP_PLATFORMS.mac,
        project,
        home: '/Users/a',
        appData: undefined,
      }),
    ).toEqual({
      app: join(project, 'out', 'Raven-darwin-arm64', 'Raven.app'),
      executable: join(
        project,
        'out',
        'Raven-darwin-arm64',
        'Raven.app',
        'Contents',
        'MacOS',
        'Raven',
      ),
      logsDir: join('/Users/a', 'Library', 'Logs', 'raven'),
    })
  })

  it("launches Raven.exe and reads the logs under %APPDATA%'s raven folder on Windows", () => {
    expect(
      smokePathsFor({
        platform: DESKTOP_PLATFORMS.windows,
        project,
        home: '/Users/a',
        appData: '/Users/a/AppData/Roaming',
      }),
    ).toEqual({
      app: join(project, 'out', 'Raven-win32-x64'),
      executable: join(project, 'out', 'Raven-win32-x64', 'Raven.exe'),
      logsDir: join('/Users/a/AppData/Roaming', 'raven', 'logs'),
    })
  })

  it('falls back to the roaming folder under home when %APPDATA% is not set', () => {
    expect(
      smokePathsFor({
        platform: DESKTOP_PLATFORMS.windows,
        project,
        home: '/Users/a',
        appData: undefined,
      }).logsDir,
    ).toBe(join('/Users/a', 'AppData', 'Roaming', 'raven', 'logs'))
  })
})

describe('SMOKE_STOP_NAMES', () => {
  it('quits macOS on SIGTERM and Windows on WM_CLOSE', () => {
    expect(SMOKE_STOP_NAMES).toEqual({ mac: 'SIGTERM', windows: 'WM_CLOSE' })
  })
})

describe('isRavenListed', () => {
  it('finds Raven in the CSV tasklist prints, whatever the case', () => {
    expect(
      isRavenListed(
        '"Raven.exe","4120","Console","1","98,304 K"\r\n"raven.exe","4180","Console","1","40,112 K"\r\n',
      ),
    ).toBe(true)
  })

  it('finds nothing in the INFO line tasklist prints when no process matches', () => {
    expect(
      isRavenListed('INFO: No tasks are running which match the specified criteria.\r\n'),
    ).toBe(false)
  })

  it('does not take another image whose name only contains Raven', () => {
    expect(isRavenListed('"NotRaven.exe","4120","Console","1","98,304 K"\r\n')).toBe(false)
  })
})
