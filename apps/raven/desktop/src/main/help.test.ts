import { describe, expect, it } from 'bun:test'
import { createHelpActions, HELP_MESSAGES } from '@/main/help'
import { redact } from '@/main/log/log'

const FOLDERS = { logs: '/tmp/raven-logs', crashDumps: '/tmp/raven-crashpad' }

const setup = ({
  openPath = async () => '',
  mkdir = async () => undefined,
  diagnostics = async () => 'raven player 0.5.4 (packaged, arm64)\n',
  writeClipboard = async () => undefined,
}: {
  openPath?: (path: string) => Promise<string>
  mkdir?: (path: string) => Promise<unknown>
  diagnostics?: () => Promise<string>
  writeClipboard?: (text: string) => Promise<unknown>
} = {}) => {
  const calls: string[] = []
  const notices: string[] = []
  const warnings: string[] = []
  const clipboard: string[] = []
  const actions = createHelpActions({
    folders: FOLDERS,
    mkdir: async (path) => {
      calls.push(`mkdir ${path}`)
      return mkdir(path)
    },
    openPath: async (path) => {
      calls.push(`open ${path}`)
      return openPath(path)
    },
    writeClipboard: async (text) => {
      await writeClipboard(text)
      clipboard.push(text)
    },
    diagnostics,
    notify: (message) => {
      notices.push(message)
    },
    warn: (message) => {
      warnings.push(message)
    },
  })
  return { actions, calls, notices, warnings, clipboard }
}

describe('createHelpActions', () => {
  it('makes the logs folder, then opens it', async () => {
    const { actions, calls, notices, warnings } = setup()
    await actions.showLogs()
    expect(calls).toEqual([`mkdir ${FOLDERS.logs}`, `open ${FOLDERS.logs}`])
    expect(notices).toEqual([])
    expect(warnings).toEqual([])
  })

  it('makes the crash reports folder, then opens it', async () => {
    const { actions, calls } = setup()
    await actions.showCrashReports()
    expect(calls).toEqual([`mkdir ${FOLDERS.crashDumps}`, `open ${FOLDERS.crashDumps}`])
  })

  it('tells the person when the logs folder would not open, and warns why', async () => {
    const { actions, notices, warnings } = setup({ openPath: async () => 'No application' })
    await actions.showLogs()
    expect(notices).toEqual([HELP_MESSAGES.noLogs])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('No application')
  })

  it('tells the person when the crash reports folder could not be made', async () => {
    const { actions, calls, notices, warnings } = setup({
      mkdir: () =>
        Promise.reject(
          Object.assign(new Error('EACCES: /Users/someone'), { code: 'EACCES', syscall: 'mkdir' }),
        ),
    })
    await actions.showCrashReports()
    expect(calls).toEqual([`mkdir ${FOLDERS.crashDumps}`])
    expect(notices).toEqual([HELP_MESSAGES.noCrashReports])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('mkdir EACCES')
    expect(warnings[0]).not.toContain('/Users')
  })

  it('tells the person when opening the folder rejects', async () => {
    const { actions, notices, warnings } = setup({
      openPath: () => Promise.reject(new Error('shell is gone')),
    })
    await actions.showLogs()
    expect(notices).toEqual([HELP_MESSAGES.noLogs])
    expect(warnings[0]).toContain('shell is gone')
  })

  it('copies the diagnostics and says so', async () => {
    const { actions, clipboard, notices, warnings } = setup()
    await actions.copyDiagnostics()
    expect(clipboard).toEqual(['raven player 0.5.4 (packaged, arm64)\n'])
    expect(notices).toEqual([HELP_MESSAGES.copied])
    expect(warnings).toEqual([])
  })

  it('says it could not copy when the diagnostics fail, and warns why', async () => {
    const { actions, clipboard, notices, warnings } = setup({
      diagnostics: () => Promise.reject(new Error('no window')),
    })
    await actions.copyDiagnostics()
    expect(clipboard).toEqual([])
    expect(notices).toEqual([HELP_MESSAGES.notCopied])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('no window')
  })

  it('says it could not copy when the clipboard refuses the text', async () => {
    const { actions, notices, warnings } = setup({
      writeClipboard: () => Promise.reject(new Error('pasteboard busy')),
    })
    await actions.copyDiagnostics()
    expect(notices).toEqual([HELP_MESSAGES.notCopied])
    expect(warnings[0]).toContain('pasteboard busy')
  })

  it('leaves a path in the folder answer for the log to scrub', async () => {
    const { actions, warnings } = setup({
      openPath: async () => 'The folder /Users/someone/Library/Logs/raven could not be opened.',
    })
    await actions.showLogs()
    expect(warnings).toHaveLength(1)
    const logged = redact(warnings[0] ?? '')
    expect(logged).toContain(HELP_MESSAGES.noLogs)
    expect(logged).not.toContain('/Users')
    expect(logged).not.toContain('someone')
  })
})
