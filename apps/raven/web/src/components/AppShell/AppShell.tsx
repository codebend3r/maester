import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useId } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Button, Icon, type IconName, useKeyShortcut } from '@raven/ui'
import { AccountMenu } from '@/components/AccountMenu/AccountMenu'
import { isAnyOf, libraryPages, useIsCurrent } from '@/components/AppShell/currentPage'
import { TabBar } from '@/components/AppShell/TabBar'
import { useIsMediumScreen } from '@/components/AppShell/useIsMediumScreen'
import { LibraryIcon } from '@/components/LibraryIcon/LibraryIcon'
import { Logo } from '@/components/Logo/Logo'
import { PageBackdrop } from '@/components/PageBackdrop/PageBackdrop'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { SiteSearch } from '@/components/SiteSearch/SiteSearch'
import { ThemePicker } from '@/components/ThemePicker/ThemePicker'
import { useFollowAdminLock } from '@/lib/adminLock'
import { librariesQuery } from '@/lib/queries'
import { TopCardNote, useScrollReset } from '@/lib/useScrollReset'
import { useServerEvents } from '@/lib/useServerEvents'
import { ravenVersion } from '@/lib/version'
import { useInProgressCount } from '@/desktop/downloadsApi'
import { DESKTOP_PATHS } from '@/desktop/paths'
import { usePageBackdrop } from '@raven/ui/headless'
import { useIsDesktop } from '@/stores/desktop'
import { useServerReach } from '@/stores/serverReach'
import { useSideMenu } from '@/stores/sideMenu'
import styles from '@/components/AppShell/AppShell.module.scss'

/**
 * A row of the side menu, marked as current when the location matches any
 * of its patterns. Down to its icon, it keeps its name for screen readers
 * and as a tooltip. A note adds its word to the name both ways:
 * `Tutorials (locked)`.
 */
const NavItem = ({
  to,
  patterns,
  icon,
  label,
  isIconsOnly,
  note,
}: {
  to: string
  patterns: readonly string[]
  icon: ReactNode
  label: string
  isIconsOnly: boolean
  note?: string
}) => {
  const isCurrent = useIsCurrent(patterns)
  const suffix = note ? ` (${note})` : ''
  return (
    <Link
      to={to}
      className={styles.navLink}
      aria-current={isCurrent ? 'page' : undefined}
      title={isIconsOnly ? `${label}${suffix}` : undefined}
    >
      {icon}
      <span className={isIconsOnly ? 'visually-hidden' : styles.label}>
        {label}
        {!!note && <span className="visually-hidden">{suffix}</span>}
      </span>
    </Link>
  )
}

/** An icon with a count over its corner, for the eye only: the row's name says the count. */
const CountedIcon = ({ icon, count }: { icon: IconName; count: number }) => (
  <span className={styles.counted}>
    <Icon name={icon} />
    {count > 0 && (
      <span className={styles.badge} aria-hidden="true">
        {count}
      </span>
    )}
  </span>
)

/** raven player's own rows: the files on this Mac, and the downloads with how many are under way. */
const DesktopNavItems = ({ isIconsOnly }: { isIconsOnly: boolean }) => {
  const inProgress = useInProgressCount()
  return (
    <>
      <NavItem
        to={DESKTOP_PATHS.local}
        patterns={[DESKTOP_PATHS.local]}
        icon={<Icon name="file-play" />}
        label="On this Mac"
        isIconsOnly={isIconsOnly}
      />
      <NavItem
        to={DESKTOP_PATHS.downloads}
        patterns={[DESKTOP_PATHS.downloads]}
        icon={<CountedIcon icon="download" count={inProgress} />}
        label="Downloads"
        isIconsOnly={isIconsOnly}
        note={inProgress > 0 ? `${inProgress} in progress` : undefined}
      />
    </>
  )
}

/**
 * What keeps the pages in step with the server while the frame is open: its
 * changes, and the admin lock coming on or going off. Left out while raven
 * player cannot reach its server.
 */
const FollowServer = () => {
  useServerEvents()
  useFollowAdminLock()
  return null
}

/** What B does on a medium screen, where the menu keeps to its icons. */
const ignore = () => undefined

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
 * The frame around every browsing page. Beside the page, the side menu
 * holds still as the page scrolls: the logo, Home and Favourites, then
 * under a Pinned heading the pinned libraries, each with its type's icon
 * (with a lock on it for a locked one, whatever its type), an open one
 * marked instead of Libraries. Libraries and Settings sit at its foot, over
 * raven's version and the toggle. The menu collapses to its icons with B or
 * the toggle and stays that way across visits; on a medium screen it is
 * down to its icons whatever the toggle says, so there the toggle and B
 * step aside. A phone has no side menu but a tab bar along the foot of the
 * screen. Over every page, a bar holds the search through every library
 * and, in its corner, the theme button and, for whoever is signed in, the
 * account button with Sign out. While a card's picture is behind the page,
 * the menu frosts over it. While the frame is open, what the pages show
 * follows the server's changes, and the admin lock coming on or going off.
 * The player leaves the frame behind for the whole screen. Inside raven
 * player the menu adds On this Mac and Downloads over Settings, and the
 * window is dragged by a strip along its top; while the app cannot reach
 * its server, the frame keeps only those three and what needs no server.
 */
export const AppShell = () => {
  const navId = useId()
  const { pathname, key } = useLocation()
  const { collapsed, tipSeen, toggle, dismissTip } = useSideMenu()
  const isMediumScreen = useIsMediumScreen()
  const isIconsOnly = collapsed || isMediumScreen
  const isFrosted = usePageBackdrop((state) => state.shown != null)
  const isDesktop = useIsDesktop()
  const isOffline = useServerReach((state) => state.isOffline)
  const libraries = useQuery({ ...librariesQuery, enabled: !isOffline })
  // Kept from before the server went out of reach, they would open pages that need it.
  const pinned = isOffline
    ? []
    : (libraries.data ?? []).filter((library) => library.settings.pinned)
  const isPinnedOpen = pinned.some((library) =>
    isAnyOf({ patterns: libraryPages(library.id), pathname }),
  )

  useKeyShortcut({ key: 'b', onPress: isMediumScreen ? ignore : toggle })
  useScrollReset()

  return (
    <div className={collapsed ? `${styles.shell} ${styles.collapsed}` : styles.shell}>
      {!isOffline && <FollowServer />}
      {/* The window has no title bar of its own: this strip is what it is dragged by. */}
      {isDesktop && <div className={styles.titlebar} aria-hidden="true" />}
      <PageBackdrop />
      <nav
        id={navId}
        className={isFrosted ? `${styles.side} ${styles.frosted}` : styles.side}
        aria-label="Main"
      >
        <Link to="/" className={styles.home}>
          <Logo isMarkOnly={isIconsOnly} />
        </Link>
        <div className={styles.links}>
          {!isOffline && (
            <>
              <NavItem
                to="/"
                patterns={['/']}
                icon={<Icon name="home" />}
                label="Home"
                isIconsOnly={isIconsOnly}
              />
              <NavItem
                to="/favourites"
                patterns={['/favourites']}
                icon={<Icon name="heart" />}
                label="Favourites"
                isIconsOnly={isIconsOnly}
              />
            </>
          )}
          {pinned.length > 0 && (
            <>
              {isIconsOnly ? (
                <span className={styles.rule} aria-hidden="true" />
              ) : (
                <p className={styles.eyebrow} aria-hidden="true">
                  Pinned
                </p>
              )}
              <ul className={styles.pinned} aria-label="Pinned">
                {pinned.map((library) => (
                  <li key={library.id} className={styles.pinnedItem}>
                    <NavItem
                      to={`/libraries/${library.id}`}
                      patterns={libraryPages(library.id)}
                      icon={<LibraryIcon settings={library.settings} />}
                      label={library.name}
                      isIconsOnly={isIconsOnly}
                      note={library.settings.locked ? 'locked' : undefined}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className={styles.dock}>
          <div className={styles.manage}>
            {!isOffline && (
              <>
                <NavItem
                  to="/libraries"
                  patterns={isPinnedOpen ? ['/libraries'] : ['/libraries', ...libraryPages(':id')]}
                  icon={<Icon name="libraries" />}
                  label="Libraries"
                  isIconsOnly={isIconsOnly}
                />
                <AdminOnly>
                  <NavItem
                    to="/streams"
                    patterns={['/streams']}
                    icon={<Icon name="playback" />}
                    label="Streams"
                    isIconsOnly={isIconsOnly}
                  />
                  <NavItem
                    to="/reports"
                    patterns={['/reports']}
                    icon={<Icon name="alert" />}
                    label="Bug reports"
                    isIconsOnly={isIconsOnly}
                  />
                </AdminOnly>
              </>
            )}
            {isDesktop && <DesktopNavItems isIconsOnly={isIconsOnly} />}
            <NavItem
              to="/settings"
              patterns={['/settings']}
              icon={<Icon name="settings" />}
              label="Settings"
              isIconsOnly={isIconsOnly}
            />
          </div>
          {!isMediumScreen && (
            <div className={styles.foot}>
              <div className={styles.toggle}>
                <Button
                  tone="ghost"
                  icon="sidebar"
                  className={styles.toggleButton}
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
          )}
        </div>
      </nav>
      <main className={styles.main}>
        <div className={styles.bar}>
          {!isOffline && <SiteSearch className={styles.search} />}
          <div className={styles.corner}>
            <ThemePicker />
            {!isOffline && <AccountMenu />}
          </div>
        </div>
        <div className={styles.page}>
          <TopCardNote pageKey={key}>
            <Outlet />
          </TopCardNote>
        </div>
      </main>
      <TabBar />
    </div>
  )
}
