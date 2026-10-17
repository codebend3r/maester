import { errorText } from '@/main/log/errorText'

export const HELP_MESSAGES = {
  copied: 'Copied the diagnostics.',
  notCopied: 'raven player could not copy the diagnostics.',
  noLogs: 'raven player could not open its logs folder.',
  noCrashReports: 'raven player could not open its crash reports folder.',
} as const

export type HelpActions = {
  showLogs: () => Promise<void>
  showCrashReports: () => Promise<void>
  copyDiagnostics: () => Promise<void>
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
}: {
  folders: { logs: string; crashDumps: string }
  mkdir: (path: string) => Promise<unknown>
  /** Electron's `shell.openPath`: '' on success, else why it failed. */
  openPath: (path: string) => Promise<string>
  /** Electron's `clipboard.writeText`, which answers a promise in this Electron. */
  writeClipboard: (text: string) => Promise<unknown>
  diagnostics: () => Promise<string>
  notify: (message: string) => void
  warn: (message: string) => void
}): HelpActions => {
  const failed = ({ message, why }: { message: string; why: string }): void => {
    notify(message)
    warn(`${message} ${why}`)
  }

  // A folder is made first: nothing may have crashed or logged into it yet.
  const show = async ({ folder, message }: { folder: string; message: string }) => {
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
