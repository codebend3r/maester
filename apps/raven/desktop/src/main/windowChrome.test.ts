import { WINDOW_ACTIONS, WINDOW_CHROMES } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { chromeOptionsFor, controlWindow } from '@/main/windowChrome'

describe('chromeOptionsFor', () => {
  it('keeps the traffic lights inset on macOS', () => {
    expect(chromeOptionsFor({ chrome: WINDOW_CHROMES.inset })).toEqual({
      titleBarStyle: 'hiddenInset',
    })
  })

  it('makes a frameless, transparent window where the page draws the controls', () => {
    expect(chromeOptionsFor({ chrome: WINDOW_CHROMES.drawn })).toEqual({
      frame: false,
      transparent: true,
    })
  })
})

describe('controlWindow', () => {
  const windowWith = (isMaximized: boolean) => {
    const calls: string[] = []
    return {
      calls,
      window: {
        minimize: () => calls.push('minimize'),
        maximize: () => calls.push('maximize'),
        unmaximize: () => calls.push('unmaximize'),
        close: () => calls.push('close'),
        isMaximized: () => isMaximized,
      },
    }
  }

  it('minimizes and closes the window', () => {
    const { window, calls } = windowWith(false)
    controlWindow({ window, action: WINDOW_ACTIONS.minimize })
    controlWindow({ window, action: WINDOW_ACTIONS.close })
    expect(calls).toEqual(['minimize', 'close'])
  })

  it('maximizes a window that is not, and restores one that is', () => {
    const normal = windowWith(false)
    controlWindow({ window: normal.window, action: WINDOW_ACTIONS.maximize })
    expect(normal.calls).toEqual(['maximize'])
    const maximized = windowWith(true)
    controlWindow({ window: maximized.window, action: WINDOW_ACTIONS.maximize })
    expect(maximized.calls).toEqual(['unmaximize'])
  })
})
