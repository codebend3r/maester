import { PAGE_ORIGIN, PLAYER_CONNECTION_STATUSES, WINDOW_MESSAGE_TYPES } from '@raven/core'
import { afterEach, describe, expect, it } from 'bun:test'
import { startDesktop } from '@/desktop/startDesktop'
import { useDesktopBridge } from '@/stores/desktop'

const noop = () => undefined

// A page left listening would take the player port another test hands over.
const stops: Array<() => void> = []
const started = (bridge: unknown) => {
  stops.push(startDesktop({ bridge, root: document.documentElement, target: window }))
}

afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
})

describe('startDesktop', () => {
  it('does nothing in a browser', () => {
    started(undefined)
    expect(useDesktopBridge.getState().desktop).toBeNull()
    expect(document.documentElement.dataset.desktop).toBeUndefined()
  })

  it("keeps raven player's bridge and marks the page as the app's", () => {
    started({ request: noop, dropFiles: noop, subscribe: noop })
    expect(useDesktopBridge.getState().desktop).not.toBeNull()
    expect(document.documentElement.dataset.desktop).toBe('')
  })

  it("hears main's player hand-over from the first render on", () => {
    started({ request: noop, dropFiles: noop, subscribe: noop })
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: WINDOW_MESSAGE_TYPES.playerPort,
          connection: { status: PLAYER_CONNECTION_STATUSES.unavailable, message: 'No mpv.' },
        },
        origin: PAGE_ORIGIN,
        source: window,
      }),
    )
    expect(useDesktopBridge.getState().desktop?.player.read()).toEqual({
      status: PLAYER_CONNECTION_STATUSES.unavailable,
      message: 'No mpv.',
    })
  })
})
