import { useQuery } from '@tanstack/react-query'
import { useEffect, useId } from 'react'
import { Link, Outlet, matchPath, useLocation } from 'react-router-dom'
import { Button } from '@/components/Button/Button'
import { Icon, type IconName } from '@/components/Icon/Icon'
import { api } from '@/lib/api'
import { isTypingTarget } from '@/lib/keyboard'
import { KIND_ICONS } from '@/lib/libraryKinds'
import { queryKeys } from '@/lib/queryClient'
import { useSideMenu } from '@/stores/sideMenu'
import styles from '@/components/AppShell/AppShell.module.scss'

/** The key that collapses and expands the side menu. */
const TOGGLE_KEY = 'b'

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
}: {
  to: string
  patterns: readonly string[]
  icon: IconName
  label: string
}) => {
  const { pathname } = useLocation()
  const collapsed = useSideMenu((state) => state.collapsed)
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

/** B pressed anywhere but in a form control or a dialog, which keep their keys. */
const isToggleKey = (event: KeyboardEvent): boolean =>
  event.key.toLowerCase() === TOGGLE_KEY &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.altKey &&
  !event.repeat &&
  !isTypingTarget(event.target) &&
  !(event.target instanceof Element && event.target.closest('dialog'))

/** Hangs under the toggle until it is first used or put away. */
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
 * own links there, each with its type's icon, and an open one is marked
 * instead of Libraries. The menu collapses to its icons with the toggle or
 * B, and stays that way across visits. The player leaves the frame behind
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isToggleKey(event)) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  return (
    <div className={collapsed ? `${styles.shell} ${styles.collapsed}` : styles.shell}>
      <header className={styles.header}>
        <Button
          icon="sidebar"
          className={styles.toggle}
          aria-label="Side menu"
          aria-expanded={!collapsed}
          aria-controls={navId}
          aria-keyshortcuts="B"
          title={`${collapsed ? 'Expand' : 'Collapse'} the side menu (B)`}
          onClick={toggle}
        />
        <Link to="/" className={styles.wordmark}>
          raven
        </Link>
        {!tipSeen && <ShortcutTip onDismiss={dismissTip} />}
      </header>
      <nav id={navId} className={styles.nav} aria-label="Main">
        <NavItem
          to="/"
          patterns={pinnedOpen ? ['/'] : ['/', ...libraryPages(':id')]}
          icon="libraries"
          label="Libraries"
        />
        <NavItem to="/favourites" patterns={['/favourites']} icon="heart" label="Favourites" />
        <NavItem to="/settings" patterns={['/settings']} icon="settings" label="Settings" />
        {pinned.length > 0 && (
          <ul className={styles.pinned} aria-label="Pinned">
            {pinned.map((library) => (
              <li key={library.id} className={styles.pinnedItem}>
                <NavItem
                  to={`/libraries/${library.id}`}
                  patterns={libraryPages(library.id)}
                  icon={KIND_ICONS[library.settings.kind]}
                  label={library.name}
                />
              </li>
            ))}
          </ul>
        )}
      </nav>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
