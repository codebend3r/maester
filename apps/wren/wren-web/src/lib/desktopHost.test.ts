import { afterEach, describe, expect, it } from 'bun:test'
import { desktopServerAddress, isOnDesktop } from '@/lib/desktopHost'
import { serverAddress } from '@/lib/serverAddress'
import { DESKTOP_SERVER, servedByDesktop } from '@/test/desktopHost'

describe('desktopHost', () => {
  const untag = { run: () => {} }

  afterEach(() => untag.run())

  it("names no server and no Mac in a browser, where the address is the page's own", () => {
    expect(desktopServerAddress()).toBeNull()
    expect(isOnDesktop()).toBe(false)
    expect(serverAddress()).toBe(window.location.origin)
  })

  it('reads the server Wren for Mac names in the page it serves', () => {
    untag.run = servedByDesktop()
    expect(desktopServerAddress()).toBe(DESKTOP_SERVER)
    expect(isOnDesktop()).toBe(true)
    expect(serverAddress()).toBe(DESKTOP_SERVER)
  })
})
