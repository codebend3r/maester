import type { ReactNode } from 'react'
import { Link, Outlet, matchPath, useLocation } from 'react-router-dom'
import styles from './AppShell.module.scss'

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
 * beside the page (below it on a narrow screen). The player leaves the
 * frame behind for the whole screen.
 */
export const AppShell = () => (
  <div className={styles.shell}>
    <header className={styles.header}>
      <Link to="/" className={styles.wordmark}>
        weirwood
      </Link>
    </header>
    <nav className={styles.nav} aria-label="Main">
      <NavItem to="/" patterns={['/', '/libraries/:id']}>
        Libraries
      </NavItem>
      <NavItem to="/favourites" patterns={['/favourites']}>
        Favourites
      </NavItem>
    </nav>
    <main className={styles.main}>
      <Outlet />
    </main>
  </div>
)
