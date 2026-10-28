import {
  DESKTOP_REQUESTS,
  WINDOW_ACTIONS,
  WINDOW_CHROMES,
  type WindowAction,
  windowChromeFor,
} from '@raven/core'
import { Icon, type IconName } from '@raven/ui'
import { handled } from '@/desktop/handled'
import { useDesktop } from '@/stores/desktop'
import { useWindowChrome } from '@/stores/windowChrome'
import styles from '@/desktop/WindowControls/WindowControls.module.scss'

const CONTROLS = [
  { action: WINDOW_ACTIONS.minimize, label: 'Minimize', icon: 'minimize' },
  { action: WINDOW_ACTIONS.maximize, label: 'Maximize or restore', icon: 'maximize' },
  { action: WINDOW_ACTIONS.close, label: 'Close', icon: 'close' },
] as const satisfies readonly { action: WindowAction; label: string; icon: IconName }[]

/**
 * Minimize, maximize and close for a window with no frame, as on Windows, at the top right
 * over every page and the player. They hide while the player has hidden its own controls,
 * as macOS's traffic lights do; on macOS they are not drawn at all.
 */
export const WindowControls = () => {
  const { client } = useDesktop()
  const isShown = useWindowChrome((state) => state.isShown)
  if (windowChromeFor({ platform: client.platform }) !== WINDOW_CHROMES.drawn) return null

  return (
    <nav
      className={[styles.controls, isShown ? '' : styles.hidden].filter(Boolean).join(' ')}
      aria-label="Window"
    >
      {CONTROLS.map(({ action, label, icon }) => (
        <button
          key={action}
          type="button"
          className={action === WINDOW_ACTIONS.close ? styles.close : styles.control}
          aria-label={label}
          title={label}
          onClick={() => handled(client.request({ type: DESKTOP_REQUESTS.windowControl, action }))}
        >
          <Icon name={icon} size={16} />
        </button>
      ))}
    </nav>
  )
}
