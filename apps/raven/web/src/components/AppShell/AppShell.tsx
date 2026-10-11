import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { Link, Outlet, matchPath, useLocation } from 'react-router-dom'
import { Button } from '@/components/Button/Button'
import { Icon, type IconName } from '@/components/Icon/Icon'
import { api } from '@/lib/api'
import { useKeyShortcut } from '@/lib/keyboard'
import { KINDS } from '@/lib/libraryKinds'
import { queryKeys } from '@/lib/queryClient'
import { useServerEvents } from '@/lib/useServerEvents'
import { useSideMenu } from '@/stores/sideMenu'
import styles from '@/components/AppShell/AppShell.module.scss'

/**
 * A link in the side menu, marked as current when the location matches any
 * of its patterns. Collapsed to its icon, it keeps its name for screen
 * readers and as a tooltip.
 */
const NavItem = ({
  to,
  patterns,
  icon,
  label,
  collapsed,
}: {
  to: string
  patterns: readonly string[]
  icon: IconName
  label: string
  collapsed: boolean
}) => {
  const { pathname } = useLocation()
  const current = patterns.some((pattern) => matchPath(pattern, pathname) != null)
  return (
    <Link
      to={to}
      className={styles.navLink}
      aria-current={current ? 'page' : undefined}
      title={collapsed ? label : undefined}
    >
      <Icon name={icon} />
      <span className={collapsed ? 'visually-hidden' : undefined}>{label}</span>
    </Link>
  )
}

/** A library's own pages: its videos and its history. */
const libraryPages = (id: number | string): string[] => [
  `/libraries/${id}`,
  `/libraries/${id}/history`,
]

/** Rises above the toggle until it is first used or put away. */
const ShortcutTip = ({ onDismiss }: { onDismiss: () => void }) => (
  <aside className={styles.tip} aria-label="Tip">
    <p>
      Press <kbd>B</kbd> to collapse or expand the side menu.
    </p>
    <Button onClick={onDismiss}>Got it</Button>
  </aside>
)

/**
 * The frame around every browsing page: the wordmark, then the side menu
 * beside the page (below it on a narrow screen). Pinned libraries get their
 * own links there, each with its type's icon (a lock for a locked one), and an open one is marked
 * instead of Libraries. The menu collapses to its icons with B or the toggle
 * at its foot, which keeps to the bottom left of the screen however far the
 * page scrolls, and stays that way across visits. While it is open, what the
 * pages show follows the server's changes. The player leaves the frame behind
 * for the whole screen.
 */
export const AppShell = () => {
  const navId = useId()
  const { pathname } = useLocation()
  const { collapsed, tipSeen, toggle, dismissTip } = useSideMenu()
  const libraries = useQuery({ queryKey: queryKeys.libraries, queryFn: api.listLibraries })
  const pinned = (libraries.data ?? []).filter((library) => library.settings.pinned)
  const pinnedOpen = pinned.some((library) =>
    libraryPages(library.id).some((pattern) => matchPath(pattern, pathname) != null),
  )

  useKeyShortcut({ key: 'b', onPress: toggle })
  useServerEvents()

  return (
    <div className={collapsed ? `${styles.shell} ${styles.collapsed}` : styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.wordmark}>
          raven
        </Link>
      </header>
      <div className={styles.side}>
        <nav id={navId} className={styles.nav} aria-label="Main">
          <NavItem
            to="/"
            patterns={pinnedOpen ? ['/'] : ['/', ...libraryPages(':id')]}
            icon="libraries"
            label="Libraries"
            collapsed={collapsed}
          />
          <NavItem
            to="/favourites"
            patterns={['/favourites']}
            icon="heart"
            label="Favourites"
            collapsed={collapsed}
          />
          <NavItem
            to="/settings"
            patterns={['/settings']}
            icon="settings"
            label="Settings"
            collapsed={collapsed}
          />
          {pinned.length > 0 && (
            <ul className={styles.pinned} aria-label="Pinned">
              {pinned.map((library) => (
                <li key={library.id} className={styles.pinnedItem}>
                  <NavItem
                    to={`/libraries/${library.id}`}
                    patterns={libraryPages(library.id)}
                    icon={library.settings.locked ? 'lock' : KINDS[library.settings.kind].icon}
                    label={library.name}
                    collapsed={collapsed}
                  />
                </li>
              ))}
            </ul>
          )}
        </nav>
        <div className={styles.dock}>
          <Button
            icon="sidebar"
            aria-label="Side menu"
            aria-expanded={!collapsed}
            aria-controls={navId}
            aria-keyshortcuts="B"
            title={`${collapsed ? 'Expand' : 'Collapse'} the side menu (B)`}
            onClick={toggle}
          />
          {!tipSeen && <ShortcutTip onDismiss={dismissTip} />}
        </div>
      </div>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
