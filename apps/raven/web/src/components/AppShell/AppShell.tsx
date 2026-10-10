import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link, Outlet, matchPath, useLocation } from 'react-router-dom'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import styles from '@/components/AppShell/AppShell.module.scss'

/** A link in the side menu, marked as current when the location matches any of its patterns. */
const NavItem = ({
  to,
  patterns,
  children,
}: {
  to: string
  patterns: readonly string[]
  children: ReactNode
}) => {
  const { pathname } = useLocation()
  const current = patterns.some((pattern) => matchPath(pattern, pathname) != null)
  return (
    <Link to={to} className={styles.navLink} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  )
}

/**
 * The frame around every browsing page: the wordmark, then the side menu
 * beside the page (below it on a narrow screen). Pinned libraries get their
 * own links there, and an open one is marked instead of Libraries. The
 * player leaves the frame behind for the whole screen.
 */
export const AppShell = () => {
  const { pathname } = useLocation()
  const libraries = useQuery({ queryKey: queryKeys.libraries, queryFn: api.listLibraries })
  const pinned = (libraries.data ?? []).filter((library) => library.settings.pinned)
  const pinnedOpen = pinned.some(
    (library) => matchPath(`/libraries/${library.id}`, pathname) != null,
  )

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.wordmark}>
          raven
        </Link>
      </header>
      <nav className={styles.nav} aria-label="Main">
        <NavItem to="/" patterns={pinnedOpen ? ['/'] : ['/', '/libraries/:id']}>
          Libraries
        </NavItem>
        <NavItem to="/favourites" patterns={['/favourites']}>
          Favourites
        </NavItem>
        {pinned.length > 0 && (
          <ul className={styles.pinned} aria-label="Pinned">
            {pinned.map((library) => (
              <li key={library.id} className={styles.pinnedItem}>
                <NavItem to={`/libraries/${library.id}`} patterns={[`/libraries/${library.id}`]}>
                  {library.name}
                </NavItem>
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
