import { isAbsolute } from 'node:path'
import type { Timers } from '@/main/stateStore'
import {
  DESKTOP_EVENTS,
  DESKTOP_REPLIES,
  type DesktopEvent,
  type DesktopReply,
  MAX_QUEUE,
} from '@/shared/protocol'

// The first item plays and the rest queue, so a batch past this has nowhere to go.
const BATCH_CAP = MAX_QUEUE + 1

/**
 * Holds opens (Finder's one `open-file` per file, links, a second launch) until the
 * renderer is ready, then hands them over in bursts so a multi-file open plays the
 * first and queues the rest instead of replacing the video once per file.
 */
export const createOpenBatch = <T>({
  delayMs,
  timers,
  deliver,
}: {
  delayMs: number
  timers: Timers
  deliver: (items: T[]) => void
}): { push: (item: T) => void; ready: () => void } => {
  let held: T[] = []
  let isReady = false
  let timer: unknown

  const release = () => {
    timer = undefined
    const items = held
    held = []
    if (items.length > 0) deliver(items)
  }

  return {
    push: (item) => {
      if (held.length < BATCH_CAP) held = [...held, item]
      if (!isReady) return
      if (timer !== undefined) timers.clear(timer)
      timer = timers.set({ run: release, ms: delayMs })
    },
    ready: () => {
      if (isReady) return
      isReady = true
      release()
    },
  }
}

/** The files a launch was asked to open: absolute paths after the executable, never switches. */
export const pathsFromArgv = (argv: readonly string[]): string[] =>
  argv.slice(1).filter((arg) => !arg.startsWith('-') && isAbsolute(arg))

/**
 * `pathsFromArgv` for a launch. Unpackaged, Electron is run as `electron <app> ...`,
 * so the first argument that is not a switch is the app's folder, not a file to open.
 */
export const launchPaths = ({
  argv,
  isDefaultApp,
}: {
  argv: readonly string[]
  isDefaultApp: boolean
}): string[] => {
  if (!isDefaultApp) return pathsFromArgv(argv)
  const appIndex = argv.findIndex((arg, index) => index > 0 && !arg.startsWith('-'))
  return pathsFromArgv(appIndex === -1 ? argv : argv.toSpliced(appIndex, 1))
}

/** What the page is told after main opens files or links on its own (Finder, a second launch, `open-url`). */
export const eventForOpen = (reply: DesktopReply): DesktopEvent | null => {
  switch (reply.type) {
    case DESKTOP_REPLIES.play:
      return { type: DESKTOP_EVENTS.play, target: reply.target }
    case DESKTOP_REPLIES.playServer:
      return { type: DESKTOP_EVENTS.playServer, target: reply.target }
    case DESKTOP_REPLIES.refused:
      return { type: DESKTOP_EVENTS.notice, message: reply.message }
    case DESKTOP_REPLIES.file:
    case DESKTOP_REPLIES.recents:
    case DESKTOP_REPLIES.output:
    case DESKTOP_REPLIES.done:
    case DESKTOP_REPLIES.servers:
    case DESKTOP_REPLIES.serverReply:
    case DESKTOP_REPLIES.serverUnreachable:
    case DESKTOP_REPLIES.updates:
      return null
    default: {
      const unreachable: never = reply
      return unreachable
    }
  }
}
