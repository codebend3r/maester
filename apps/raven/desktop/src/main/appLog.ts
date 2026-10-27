import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { errorText } from '@/main/log/errorText'
import { createLog, type Log, logFsFrom, SILENT_LOG } from '@/main/log/log'
import type { Timers } from '@/main/stateStore'

type ReportErrorProps = { text: string; error: unknown }

/** The app's log and the lines main writes around it, on stdout too while unpackaged. */
export type AppLog = {
  log: Log
  warn: (message: string) => void
  reportError: (input: ReportErrorProps) => void
  /** A budget mark (Ruling 13): always logged, and on stdout unpackaged, where e2e reads it. */
  mark: (line: string) => void
}

type CreateAppLogProps = {
  /** A second instance keeps no log: it hands its files to the first and quits. */
  isPrimary: boolean
  isPackaged: boolean
  dir: string
  timers: Timers
}

export const createAppLog = ({ isPrimary, isPackaged, dir, timers }: CreateAppLogProps): AppLog => {
  // A second instance would write a false launch into the first one's file and rotate that
  // file from two processes.
  const log = isPrimary
    ? createLog({
        dir,
        fs: logFsFrom({ mkdir, stat, appendFile, rename, rm }),
        now: Date.now,
        timers,
        onError: (error) => {
          console.error('Raven could not write its log.', error)
        },
      })
    : SILENT_LOG

  return {
    log,
    warn: (message) => {
      log.warn(message)
      if (!isPackaged) console.warn(message)
    },
    reportError: ({ text, error }) => {
      const message = `${text} ${errorText(error)}`
      log.error(message)
      if (!isPackaged) console.error(message)
    },
    mark: (line) => {
      log.mark(line.trim())
      if (!isPackaged) process.stdout.write(line)
    },
  }
}
