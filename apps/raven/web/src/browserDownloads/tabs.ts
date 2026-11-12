import { type Infer, isNumber, isOpaqueId, nullable, object, oneOf, union } from '@raven/core'

/** What one tab tells the others: the index changed, or how the download on its way is doing. */
export const TAB_MESSAGES = { index: 'index', running: 'running' } as const

/** The download the queue's tab is on: the bytes it has once they come, and how far along the server's copy is. */
const isRunning = object({
  downloadId: isOpaqueId,
  bytes: nullable(isNumber),
  preparing: nullable(isNumber),
})

export type Running = Infer<typeof isRunning>

const isTabMessage = union(
  object({ kind: oneOf([TAB_MESSAGES.index]) }),
  object({ kind: oneOf([TAB_MESSAGES.running]), running: nullable(isRunning) }),
)

export type TabMessage = Infer<typeof isTabMessage>

export const INDEX_CHANGED = { kind: TAB_MESSAGES.index } as const satisfies TabMessage

type TabListener = (message: TabMessage) => void

type OnHeld = () => void

/** What a tab does with the index while it alone holds it. */
type IndexTurn<T> = () => Promise<T>

/**
 * What keeps the tabs of one browser from running over each other: they share one disk and one
 * index. One tab holds the queue and downloads; every tab changes the index only in its turn, and
 * tells the others when it has.
 */
export type DownloadTabs = {
  /** Calls `onHeld` once this tab is the one that runs the queue, which it stays until it closes. */
  holdQueue: (onHeld: OnHeld) => void
  /** Runs `task` while no other tab reads and writes the index. */
  withIndex: <T>(task: IndexTurn<T>) => Promise<T>
  announce: (message: TabMessage) => void
  listen: (listener: TabListener) => void
}

const QUEUE_LOCK = 'raven-downloads-queue'

const INDEX_LOCK = 'raven-downloads-index'

const CHANNEL = 'raven-downloads'

export const MESSAGE = 'message'

/** The part of `navigator.locks` the tabs use. */
type TabLocks = {
  request: (name: string, callback: () => Promise<unknown>) => Promise<unknown>
}

type TabChannel = {
  postMessage: (message: TabMessage) => void
  addEventListener: (type: typeof MESSAGE, listener: (event: MessageEvent) => void) => void
}

export type TabsWindow = {
  navigator: { locks?: TabLocks }
  BroadcastChannel?: new (name: string) => TabChannel
}

/**
 * The tabs over the Web Locks API and a broadcast channel. A browser with no locks has one tab's
 * word for it: that tab runs the queue and writes as it comes, as every tab did before.
 */
export const browserTabs = ({ navigator, BroadcastChannel }: TabsWindow): DownloadTabs => {
  const { locks } = navigator
  const channel = BroadcastChannel === undefined ? null : new BroadcastChannel(CHANNEL)
  return {
    holdQueue: (onHeld) => {
      if (locks === undefined) return onHeld()
      locks
        .request(QUEUE_LOCK, () => {
          onHeld()
          // Never settled, so the lock is this tab's until it closes and the next in line takes it.
          return new Promise<never>(() => {})
        })
        .catch(() => undefined)
    },
    withIndex: <T>(task: IndexTurn<T>): Promise<T> => {
      if (locks === undefined) return task()
      return new Promise<T>((resolve, reject) => {
        locks.request(INDEX_LOCK, () => task().then(resolve, reject)).catch(reject)
      })
    },
    announce: (message) => {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a broadcast channel reaches its own origin alone, and takes no target
      channel?.postMessage(message)
    },
    listen: (listener) => {
      channel?.addEventListener(MESSAGE, ({ data }) => {
        if (isTabMessage(data)) listener(data)
      })
    },
  }
}
