import { errorText } from '@/main/log/errorText'

export const HELP_MESSAGES = {
  copied: 'Copied the diagnostics.',
  notCopied: 'Raven could not copy the diagnostics.',
  noLogs: 'Raven could not open its logs folder.',
  noCrashReports: 'Raven could not open its crash reports folder.',
} as const

export type HelpActions = {
  showLogs: () => Promise<void>
  showCrashReports: () => Promise<void>
  copyDiagnostics: () => Promise<void>
}

type CreateHelpActionsProps = {
  folders: { logs: string; crashDumps: string }
  mkdir: (path: string) => Promise<unknown>
  /** Electron's `shell.openPath`: '' on success, else why it failed. */
  openPath: (path: string) => Promise<string>
  /** Electron's `clipboard.writeText`, which answers a promise in this Electron. */
  writeClipboard: (text: string) => Promise<unknown>
  diagnostics: () => Promise<string>
  notify: (message: string) => void
  warn: (message: string) => void
}

/** The Help menu's own items. None of them rejects: a failure is a notice and a warning. */
export const createHelpActions = ({
  folders,
  mkdir,
  openPath,
  writeClipboard,
  diagnostics,
  notify,
  warn,
}: CreateHelpActionsProps): HelpActions => {
  type FailedProps = { message: string; why: string }

  const failed = ({ message, why }: FailedProps): void => {
    notify(message)
    warn(`${message} ${why}`)
  }

  type ShowProps = { folder: string; message: string }

  // A folder is made first: nothing may have crashed or logged into it yet.
  const show = async ({ folder, message }: ShowProps) => {
    try {
      await mkdir(folder)
      const answer = await openPath(folder)
      if (answer === '') return
      failed({ message, why: answer })
    } catch (error) {
      failed({ message, why: errorText(error) })
    }
  }

  return {
    showLogs: () => show({ folder: folders.logs, message: HELP_MESSAGES.noLogs }),
    showCrashReports: () =>
      show({ folder: folders.crashDumps, message: HELP_MESSAGES.noCrashReports }),
    copyDiagnostics: async () => {
      try {
        await writeClipboard(await diagnostics())
        notify(HELP_MESSAGES.copied)
      } catch (error) {
        failed({ message: HELP_MESSAGES.notCopied, why: errorText(error) })
      }
    },
  }
}
