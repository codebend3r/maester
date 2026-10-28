import { WINDOW_ACTIONS, WINDOW_CHROMES, WINDOW_EDGES } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import {
  chromeOptionsFor,
  controlWindow,
  createWindowResizer,
  resizedBounds,
} from '@/main/windowChrome'

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

describe('resizedBounds', () => {
  const start = { x: 100, y: 100, width: 800, height: 600 }
  const minimum = { width: 320, height: 240 }
  const from = { x: 500, y: 500 }

  it('moves only the right and bottom sides for the bottom right corner', () => {
    expect(
      resizedBounds({
        edge: WINDOW_EDGES.bottomRight,
        start,
        from,
        to: { x: 550, y: 480 },
        minimum,
      }),
    ).toEqual({ x: 100, y: 100, width: 850, height: 580 })
  })

  it('keeps the right and bottom sides put for the top left corner', () => {
    expect(
      resizedBounds({ edge: WINDOW_EDGES.topLeft, start, from, to: { x: 450, y: 530 }, minimum }),
    ).toEqual({ x: 50, y: 130, width: 850, height: 570 })
  })

  it('leaves the other axis alone for a side edge', () => {
    expect(
      resizedBounds({ edge: WINDOW_EDGES.left, start, from, to: { x: 520, y: 900 }, minimum }),
    ).toEqual({ x: 120, y: 100, width: 780, height: 600 })
    expect(
      resizedBounds({ edge: WINDOW_EDGES.top, start, from, to: { x: 0, y: 450 }, minimum }),
    ).toEqual({ x: 100, y: 50, width: 800, height: 650 })
  })

  it('stops at the minimum size without moving the side it holds still', () => {
    expect(
      resizedBounds({ edge: WINDOW_EDGES.topLeft, start, from, to: { x: 2000, y: 2000 }, minimum }),
    ).toEqual({ x: 580, y: 460, width: 320, height: 240 })
  })
})

describe('createWindowResizer', () => {
  type WindowAtProps = { isMaximized?: boolean }

  const windowAt = ({ isMaximized = false }: WindowAtProps = {}) => {
    const set: unknown[] = []
    return {
      set,
      window: {
        getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
        setBounds: (bounds: unknown) => {
          set.push(bounds)
        },
        getMinimumSize: () => [320, 240],
        isMaximized: () => isMaximized,
        isFullScreen: () => false,
      },
    }
  }

  it('resizes from the bounds the drag started at on every move', () => {
    const resizer = createWindowResizer()
    const { window, set } = windowAt()
    resizer.start({ window, edge: WINDOW_EDGES.right, at: { x: 800, y: 300 } })
    resizer.move({ window, to: { x: 850, y: 300 } })
    resizer.move({ window, to: { x: 900, y: 300 } })
    expect(set).toEqual([
      { x: 0, y: 0, width: 850, height: 600 },
      { x: 0, y: 0, width: 900, height: 600 },
    ])
  })

  it('leaves a maximized window, and a move with no drag, alone', () => {
    const resizer = createWindowResizer()
    const { window, set } = windowAt({ isMaximized: true })
    resizer.move({ window, to: { x: 10, y: 10 } })
    resizer.start({ window, edge: WINDOW_EDGES.right, at: { x: 800, y: 300 } })
    resizer.move({ window, to: { x: 850, y: 300 } })
    expect(set).toEqual([])
  })
})
