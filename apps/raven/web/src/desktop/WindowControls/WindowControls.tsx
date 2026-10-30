import {
  DESKTOP_REQUESTS,
  WINDOW_ACTIONS,
  WINDOW_CHROMES,
  type WindowAction,
  type WindowChrome,
  windowChromeFor,
} from '@raven/core'
import { Icon, type IconName } from '@raven/ui'
import type { ComponentType } from 'react'
import { WINDOW_CONTROLS_COPY } from '@/desktop/WindowControls/copy'
import { handled } from '@/desktop/handled'
import { useDesktop } from '@/stores/desktop'
import { useWindowChrome } from '@/stores/windowChrome'
import styles from '@/desktop/WindowControls/WindowControls.module.scss'
import { COMMON_COPY } from '@/lib/copy'

const CONTROLS = [
  { action: WINDOW_ACTIONS.minimize, label: WINDOW_CONTROLS_COPY.minimize, icon: 'minimize' },
  { action: WINDOW_ACTIONS.maximize, label: WINDOW_CONTROLS_COPY.maximize, icon: 'maximize' },
  { action: WINDOW_ACTIONS.close, label: COMMON_COPY.close, icon: 'close' },
] as const satisfies readonly { action: WindowAction; label: string; icon: IconName }[]

/** The page draws the controls itself. */
const DrawnControls = () => {
  const { client } = useDesktop()
  const isShown = useWindowChrome((state) => state.isShown)
  return (
    <nav
      className={[styles.controls, isShown ? '' : styles.hidden].filter(Boolean).join(' ')}
      aria-label={WINDOW_CONTROLS_COPY.window}
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

/** The system draws the controls, as macOS's traffic lights. */
const SystemControls = () => null

const CONTROLS_BY_CHROME = {
  [WINDOW_CHROMES.inset]: SystemControls,
  [WINDOW_CHROMES.drawn]: DrawnControls,
} as const satisfies Record<WindowChrome, ComponentType>

/**
 * Minimize, maximize and close for a window with no frame, as on Windows, at the top right
 * over every page and the player. They hide while the player has hidden its own controls,
 * as macOS's traffic lights do; on macOS they are not drawn at all.
 */
export const WindowControls = () => {
  const { client } = useDesktop()
  const Controls = CONTROLS_BY_CHROME[windowChromeFor({ platform: client.platform })]
  return <Controls />
}
