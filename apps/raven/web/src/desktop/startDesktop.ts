import { PAGE_ORIGIN, windowChromeFor } from '@raven/core'
import { listenForAudio } from '@/desktop/audioConnection'
import { clientFor } from '@/desktop/client'
import { createMenuHub } from '@/desktop/menuHub'
import { listenForPlayer } from '@/desktop/playerConnection'
import { useDesktopBridge } from '@/stores/desktop'

type StartDesktopProps = {
  bridge: unknown
  root: HTMLElement
  /** The window main's player port is posted to. */
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>
}

/**
 * Inside Raven, puts its bridge in `useDesktopBridge` and marks the page as the app's with
 * the window chrome its platform has, which the title bar inset reads; in a browser it does nothing. Called once, before the first
 * render, so every component that reads the bridge finds it, and so the player hand-over that
 * answers the page's `ready` is heard. Returns what stops it listening for that hand-over, for a
 * page that goes away without unloading, as a test's does.
 */
export const startDesktop = ({ bridge, root, target }: StartDesktopProps): (() => void) => {
  const client = clientFor(bridge)
  if (client === null) return () => {}
  const player = listenForPlayer({ target, origin: PAGE_ORIGIN })
  const audio = listenForAudio({ target, origin: PAGE_ORIGIN })
  useDesktopBridge.setState({ desktop: { client, menu: createMenuHub(), player, audio } })
  root.dataset.desktop = windowChromeFor({ platform: client.platform })
  return () => {
    player.dispose()
    audio.dispose()
  }
}
