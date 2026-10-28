import { WINDOW_ACTIONS, WINDOW_CHROMES, type WindowAction, type WindowChrome } from '@raven/core'
import type { BaseWindow, BrowserWindowConstructorOptions } from 'electron'

const TITLE_BAR_STYLES = { hiddenInset: 'hiddenInset' } as const

type ChromeOptionsForProps = {
  chrome: WindowChrome
}

/**
 * The window options each chrome needs. macOS keeps its traffic lights over a page that runs
 * under the title bar. Windows composites mpv's video under the page only in a transparent
 * window, and a transparent window cannot have a frame, so the page draws the controls.
 */
export const chromeOptionsFor = ({
  chrome,
}: ChromeOptionsForProps): BrowserWindowConstructorOptions => {
  switch (chrome) {
    case WINDOW_CHROMES.inset:
      return { titleBarStyle: TITLE_BAR_STYLES.hiddenInset }
    case WINDOW_CHROMES.drawn:
      return { frame: false, transparent: true }
    default: {
      const unreachable: never = chrome
      return unreachable
    }
  }
}

type ControlWindowProps = {
  window: Pick<BaseWindow, 'minimize' | 'maximize' | 'unmaximize' | 'isMaximized' | 'close'>
  action: WindowAction
}

/** What a page-drawn control does to the window. */
export const controlWindow = ({ window, action }: ControlWindowProps): void => {
  switch (action) {
    case WINDOW_ACTIONS.minimize:
      return window.minimize()
    case WINDOW_ACTIONS.maximize:
      return window.isMaximized() ? window.unmaximize() : window.maximize()
    case WINDOW_ACTIONS.close:
      return window.close()
    default: {
      const unreachable: never = action
      return unreachable
    }
  }
}
