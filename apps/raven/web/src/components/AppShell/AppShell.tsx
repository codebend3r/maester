import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useId } from 'react'
import { Link, Outlet, matchPath, useLocation } from 'react-router-dom'
import { Button } from '@/components/Button/Button'
import { Icon } from '@/components/Icon/Icon'
import { LibraryIcon } from '@/components/LibraryIcon/LibraryIcon'
import { Logo } from '@/components/Logo/Logo'
import { PageBackdrop } from '@/components/PageBackdrop/PageBackdrop'
import { useFollowAdminLock } from '@/lib/adminLock'
import { useKeyShortcut } from '@/lib/keyboard'
import { librariesQuery } from '@/lib/queries'
import { TopCardNote, useScrollReset } from '@/lib/useScrollReset'
import { useServerEvents } from '@/lib/useServerEvents'
import { ravenVersion } from '@/lib/version'
import { usePageBackdrop } from '@/stores/pageBackdrop'
import { useSideMenu } from '@/stores/sideMenu'
import styles from '@/components/AppShell/AppShell.module.scss'

/**
 * A link in the side menu, marked as current when the location matches any
 * of its patterns. Collapsed to its icon, it keeps its name for screen
 * readers and as a tooltip. A note adds its word to the name both ways:
 * `Tutorials (locked)`.
 */
const NavItem = ({
  to,
  patterns,
  icon,
  label,
  collapsed,
  note,
}: {
  to: string
  patterns: readonly string[]
  icon: ReactNode
  label: string
  collapsed: boolean
  note?: string
}) => {
  const { pathname } = useLocation()
  const current = patterns.some((pattern) => matchPath(pattern, pathname) != null)
  const suffix = note ? ` (${note})` : ''
  return (
    <Link
      to={to}
      className={styles.navLink}
      aria-current={current ? 'page' : undefined}
      title={collapsed ? `${label}${suffix}` : undefined}
    >
      {icon}
      <span className={collapsed ? 'visually-hidden' : undefined}>
        {label}
        {note && <span className="visually-hidden">{suffix}</span>}
      </span>
    </Link>
  )
}

/** A library's own pages: its videos, its other tabs, its history and its sagas. */
const libraryPages = (id: number | string): string[] => [
  `/libraries/${id}`,
  `/libraries/${id}/:page`,
  `/libraries/${id}/sagas/:saga`,
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
 * The frame around every browsing page: the logo, then the side menu
 * beside the page (below it on a narrow screen): Home and Favourites, then
 * the pinned libraries, each with its type's icon (with a lock on it for a
 * locked one, whatever its type), an open one marked instead of Libraries.
 * Libraries and Settings sit at its foot, above the toggle, and keep to the
 * bottom of the screen however far the page scrolls; on a narrow screen they
 * end the row. The menu collapses to its icons with B or the toggle, and
 * stays that way across visits; expanded on a wide screen, it shows raven's
 * version beside the toggle. While a card's picture is behind the page, the
 * menu frosts over it. While the frame is open, what the pages show follows
 * the server's changes, and the admin lock coming on or going off. The player leaves the frame behind for the
 * whole screen.
 */
export const AppShell = () => {
  const navId = useId()
  const { pathname, key } = useLocation()
  const { collapsed, tipSeen, toggle, dismissTip } = useSideMenu()
  const isFrosted = usePageBackdrop((state) => state.shown != null)
  const libraries = useQuery(librariesQuery)
  const pinned = (libraries.data ?? []).filter((library) => library.settings.pinned)
  const pinnedOpen = pinned.some((library) =>
    libraryPages(library.id).some((pattern) => matchPath(pattern, pathname) != null),
  )

  useKeyShortcut({ key: 'b', onPress: toggle })
  useServerEvents()
  useFollowAdminLock()
  useScrollReset()

  return (
    <div className={collapsed ? `${styles.shell} ${styles.collapsed}` : styles.shell}>
      <PageBackdrop />
      <header className={styles.header}>
        <Link to="/" className={styles.home}>
          <Logo />
        </Link>
      </header>
      <nav
        id={navId}
        className={isFrosted ? `${styles.side} ${styles.frosted}` : styles.side}
        aria-label="Main"
      >
        <div className={styles.links}>
          <NavItem
            to="/"
            patterns={['/']}
            icon={<Icon name="home" />}
            label="Home"
            collapsed={collapsed}
          />
          <NavItem
            to="/favourites"
            patterns={['/favourites']}
            icon={<Icon name="heart" />}
            label="Favourites"
            collapsed={collapsed}
          />
          {pinned.length > 0 && (
            <ul className={styles.pinned} aria-label="Pinned">
              {pinned.map((library) => (
                <li key={library.id} className={styles.pinnedItem}>
                  <NavItem
                    to={`/libraries/${library.id}`}
                    patterns={libraryPages(library.id)}
                    icon={<LibraryIcon settings={library.settings} />}
                    label={library.name}
                    collapsed={collapsed}
                    note={library.settings.locked ? 'locked' : undefined}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={styles.dock}>
          <div className={styles.manage}>
            <NavItem
              to="/libraries"
              patterns={pinnedOpen ? ['/libraries'] : ['/libraries', ...libraryPages(':id')]}
              icon={<Icon name="libraries" />}
              label="Libraries"
              collapsed={collapsed}
            />
            <NavItem
              to="/settings"
              patterns={['/settings']}
              icon={<Icon name="settings" />}
              label="Settings"
              collapsed={collapsed}
            />
          </div>
          <div className={styles.foot}>
            <div className={styles.toggle}>
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
            {!collapsed && <p className={styles.version}>v{ravenVersion}</p>}
          </div>
        </div>
      </nav>
      <main className={styles.main}>
        <TopCardNote pageKey={key}>
          <Outlet />
        </TopCardNote>
      </main>
    </div>
  )
}
