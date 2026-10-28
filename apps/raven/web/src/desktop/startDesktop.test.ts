import {
  DESKTOP_PLATFORMS,
  PAGE_ORIGIN,
  PLAYER_CONNECTION_STATUSES,
  WINDOW_CHROMES,
  WINDOW_MESSAGE_TYPES,
} from '@raven/core'
import { afterEach, describe, expect, it } from 'bun:test'
import { startDesktop } from '@/desktop/startDesktop'
import { useDesktopBridge } from '@/stores/desktop'

const noop = () => undefined
const bridgeWith = (platform: string) => ({
  request: noop,
  dropFiles: noop,
  subscribe: noop,
  platform,
})

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

  it("keeps Raven's bridge and marks the page as the app's, with its window chrome", () => {
    started(bridgeWith(DESKTOP_PLATFORMS.mac))
    expect(useDesktopBridge.getState().desktop).not.toBeNull()
    expect(document.documentElement.dataset.desktop).toBe(WINDOW_CHROMES.inset)
  })

  it('marks a page that draws its own window controls, as on Windows', () => {
    started(bridgeWith(DESKTOP_PLATFORMS.windows))
    expect(document.documentElement.dataset.desktop).toBe(WINDOW_CHROMES.drawn)
  })

  it("hears main's player hand-over from the first render on", () => {
    started(bridgeWith(DESKTOP_PLATFORMS.mac))
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
