import { serverNameFor } from '@raven/core'
import { Icon, classNames } from '@raven/ui'
import { useActiveServer } from '@raven/ui/headless'
import { useId } from 'react'
import { NavTip } from '@/components/AppShell/NavTip'
import { SERVER_SWITCHER_COPY } from '@/components/ServerSwitcher/copy'
import styles from '@/components/ServerSwitcher/ServerSwitcher.module.scss'
import { type ServerEntry, isActiveEntry, isReachableFromPage, useOpenServer } from '@/lib/servers'
import { useMenu } from '@/lib/useMenu'

type ServerSwitcherProps = {
  servers: readonly ServerEntry[]
  isIconsOnly: boolean
}

/**
 * The side menu's server: the one in use, named beside a globe (the globe alone, named in a
 * tooltip, when the menu is down to its icons), opening a menu of every server on the list
 * with the one in use checked. Picking another switches to it and opens its Home, since the page
 * open was the last server's. A server this https page cannot call (an http address) is listed
 * but cannot be picked, and says it needs an https address.
 */
export const ServerSwitcher = ({ servers, isIconsOnly }: ServerSwitcherProps) => {
  const id = useId()
  const active = useActiveServer((state) => state.active)
  const open = useOpenServer()
  const { isOpen, toggle, close, root, trigger, list, onKeyDown } = useMenu()
  const current = servers.find((server) => isActiveEntry({ server, active }))
  const currentName = current?.name ?? serverNameFor(active?.origin ?? '')
  const choose = (server: ServerEntry) => {
    close({ refocus: false })
    open(server)
  }
  return (
    <div ref={root} className={styles.switcher}>
      <NavTip text={SERVER_SWITCHER_COPY.using(currentName)} isOn={isIconsOnly && !isOpen}>
        {(handlers) => (
          <button
            ref={trigger}
            type="button"
            className={classNames([styles.trigger, isIconsOnly && styles.iconsOnly])}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            aria-controls={id}
            aria-label={SERVER_SWITCHER_COPY.using(currentName)}
            onClick={toggle}
            {...handlers}
          >
            <Icon name="globe" />
            {!isIconsOnly && (
              <span className={styles.current} aria-hidden="true">
                <span className={styles.eyebrow}>{SERVER_SWITCHER_COPY.server}</span>
                <span className={styles.name}>{currentName}</span>
              </span>
            )}
          </button>
        )}
      </NavTip>
      {isOpen && (
        <ul
          ref={list}
          id={id}
          role="menu"
          aria-label={SERVER_SWITCHER_COPY.servers}
          className={styles.menu}
          onKeyDown={onKeyDown}
        >
          {servers.map((server) => {
            const canReach = isReachableFromPage({ origin: server.origin })
            const isActive = isActiveEntry({ server, active })
            return (
              <li key={server.key} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  disabled={!canReach}
                  className={styles.item}
                  onClick={() => choose(server)}
                >
                  <span className={styles.check}>
                    {isActive && <Icon name="check" size={16} />}
                  </span>
                  <span className={styles.itemName}>
                    {server.name}
                    {!canReach && (
                      <span className={styles.note}>{SERVER_SWITCHER_COPY.needsHttps}</span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
