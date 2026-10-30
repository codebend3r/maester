import { setTimeout as sleep } from 'node:timers/promises'
import { app, type BrowserWindow } from 'electron'
import { createQuitGate } from '@/main/quitGate'
import { CLOSE_TIMEOUTS, closeTimeoutFor, DESTROY_MS } from '@/main/shutdown'

/** What a window close waits on: each engine's life and its destroy. */
export type ClosableEngine = { isAlive: () => boolean; destroy: () => Promise<void> }

type CloseWindowAfterEnginesProps = {
  window: BrowserWindow
  engines: readonly ClosableEngine[]
}

/** Whether any of the window's engines is alive, which the app's quit asks too. */
export const isAnyEngineAlive = (engines: readonly ClosableEngine[]): boolean =>
  engines.some((engine) => engine.isAlive())

/** Destroys every engine together. */
export const destroyEngines = (engines: readonly ClosableEngine[]): Promise<void> =>
  Promise.all(engines.map((engine) => engine.destroy())).then(() => undefined)

/**
 * The window goes only once every engine has stopped: mpv drawing into it, and the music.
 * Past `DESTROY_MS` with one still alive the app quits instead, and its own gate flushes
 * the stores (see `closeTimeoutFor`).
 */
export const closeWindowAfterEngines = ({
  window,
  engines,
}: CloseWindowAfterEnginesProps): void => {
  window.on(
    'close',
    createQuitGate({
      isDirty: () => isAnyEngineAlive(engines),
      flush: () => destroyEngines(engines),
      timeoutMs: DESTROY_MS,
      quit: () => window.close(),
      exit: () => {
        const ending = closeTimeoutFor({ isEngineAlive: isAnyEngineAlive(engines) })
        switch (ending) {
          case CLOSE_TIMEOUTS.quitApp:
            app.quit()
            return
          case CLOSE_TIMEOUTS.destroyWindow:
            window.destroy()
            return
          default: {
            const unreachable: never = ending
            return unreachable
          }
        }
      },
      wait: (ms) => sleep(ms),
    }),
  )
}
