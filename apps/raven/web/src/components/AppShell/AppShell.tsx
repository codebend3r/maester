import { DESKTOP_PATHS, PAGE_PATHS } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { type ComponentType, type ReactNode, useId } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Button, Icon, type IconName, useKeyShortcut } from '@raven/ui'
import { AccountMenu } from '@/components/AccountMenu/AccountMenu'
import { APP_SHELL_COPY } from '@/components/AppShell/copy'
import { isAnyOf, libraryPages, useIsCurrent } from '@/components/AppShell/currentPage'
import { FollowServer } from '@/components/AppShell/FollowServer'
import { NavTip } from '@/components/AppShell/NavTip'
import { TabBar } from '@/components/AppShell/TabBar'
import { useIsMediumScreen } from '@/components/AppShell/useIsMediumScreen'
import { LibraryIcon } from '@/components/LibraryIcon/LibraryIcon'
import { Logo } from '@/components/Logo/Logo'
import { PageBackdrop } from '@/components/PageBackdrop/PageBackdrop'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { ADMIN_COPY, ADMIN_PATH } from '@/pages/SettingsPage/adminCopy'
import { SiteSearch } from '@/components/SiteSearch/SiteSearch'
import { ThemePicker } from '@/components/ThemePicker/ThemePicker'
import { MUSIC_PATHS, musicLibrariesOf } from '@/lib/music'
import { librariesQuery } from '@/lib/queries'
import { TopCardNote, useScrollReset } from '@/lib/useScrollReset'
import { ravenVersion } from '@/lib/version'
import { useInProgressCount } from '@/desktop/downloadsApi'
import { usePageBackdrop } from '@raven/ui/headless'
import { useComputerName, useIsDesktop } from '@/stores/desktop'
import { useServerReach } from '@/stores/serverReach'
import { SIDE_MENU_KEY, useSideMenu } from '@/stores/sideMenu'
import styles from '@/components/AppShell/AppShell.module.scss'
import { COMMON_COPY } from '@/lib/copy'
import { BINGE_COPY, BINGE_PATH } from '@/lib/binge'

type NavItemProps = {
  to: string
  patterns: readonly string[]
  icon: ReactNode
  label: string
  isIconsOnly: boolean
  note?: string
}

/**
 * A row of the side menu, marked as current when the location matches any
 * of its patterns. Down to its icon, it keeps its name for screen readers
 * and shows it as a tooltip at once. A note adds its word to the name both ways:
 * `Tutorials (locked)`.
 */
const NavItem = ({ to, patterns, icon, label, isIconsOnly, note }: NavItemProps) => {
  const isCurrent = useIsCurrent(patterns)
  const suffix = note ? APP_SHELL_COPY.noteSuffix(note) : ''
  return (
    <NavTip text={`${label}${suffix}`} isOn={isIconsOnly}>
      {(handlers) => (
        <Link
          to={to}
          className={styles.navLink}
          aria-current={isCurrent ? 'page' : undefined}
          {...handlers}
        >
          {icon}
          <span className={isIconsOnly ? 'visually-hidden' : styles.label}>
            {label}
            {!!note && <span className="visually-hidden">{suffix}</span>}
          </span>
        </Link>
      )}
    </NavTip>
  )
}

type CountedIconProps = { icon: IconName; count: number }

/** An icon with a count over its corner, for the eye only: the row's name says the count. */
const CountedIcon = ({ icon, count }: CountedIconProps) => (
  <span className={styles.counted}>
    <Icon name={icon} />
    {count > 0 && (
      <span className={styles.badge} aria-hidden="true">
        {count}
      </span>
    )}
  </span>
)

type DesktopNavItemsProps = { isIconsOnly: boolean }

/** Raven's own rows: the files on this computer, and the downloads with how many are under way. */
const DesktopNavItems = ({ isIconsOnly }: DesktopNavItemsProps) => {
  const inProgress = useInProgressCount()
  const computer = useComputerName()
  return (
    <>
      <NavItem
        to={DESKTOP_PATHS.local}
        patterns={[DESKTOP_PATHS.local]}
        icon={<Icon name="file-play" />}
        label={APP_SHELL_COPY.onThisComputer(computer)}
        isIconsOnly={isIconsOnly}
      />
      <NavItem
        to={DESKTOP_PATHS.downloads}
        patterns={[DESKTOP_PATHS.downloads]}
        icon={<CountedIcon icon="download" count={inProgress} />}
        label={COMMON_COPY.downloads}
        isIconsOnly={isIconsOnly}
        note={inProgress > 0 ? APP_SHELL_COPY.inProgress(inProgress) : undefined}
      />
    </>
  )
}

type ManageGroupProps = { isIconsOnly: boolean; children: ReactNode }

/**
 * Libraries to Settings under a Manage button that folds them away and
 * remembers it, the menu open or down to its icons, where the button keeps
 * only its chevron and names itself in a tooltip.
 */
const ManageGroup = ({ isIconsOnly, children }: ManageGroupProps) => {
  const groupId = useId()
  const isFolded = useSideMenu((state) => state.isManageFolded)
  const toggleManage = useSideMenu((state) => state.toggleManage)
  return (
    <>
      <NavTip
        text={isFolded ? APP_SHELL_COPY.showManage : APP_SHELL_COPY.hideManage}
        isOn={isIconsOnly}
      >
        {(handlers) => (
          <button
            type="button"
            className={styles.manageToggle}
            aria-expanded={!isFolded}
            aria-controls={groupId}
            aria-label={isIconsOnly ? APP_SHELL_COPY.manage : undefined}
            onClick={toggleManage}
            {...handlers}
          >
            {!isIconsOnly && <span className={styles.manageLabel}>{APP_SHELL_COPY.manage}</span>}
            <span className={styles.chevron}>
              <Icon name="expand" size={16} />
            </span>
          </button>
        )}
      </NavTip>
      <div id={groupId} className={styles.manage} hidden={isFolded}>
        {children}
      </div>
    </>
  )
}

/** What B does on a medium screen, where the menu keeps to its icons. */
const ignore = () => undefined

type ShortcutTipProps = { onDismiss: () => void }

/** Rises above the toggle until it is first used or put away. */
const ShortcutTip = ({ onDismiss }: ShortcutTipProps) => (
  <aside className={styles.tip} aria-label={APP_SHELL_COPY.tip}>
    <p>
      {APP_SHELL_COPY.tipPress} <kbd>{APP_SHELL_COPY.tipKey}</kbd> {APP_SHELL_COPY.tipAction}
    </p>
    <Button onClick={onDismiss}>{APP_SHELL_COPY.gotIt}</Button>
  </aside>
)

/** How wide the side menu is: open, or down to its icons. */
const MENU_WIDTHS = {
  open: 'open',
  icons: 'icons',
} as const

type MenuWidth = (typeof MENU_WIDTHS)[keyof typeof MENU_WIDTHS]

/** What heads the pinned libraries: a rule for the icons alone, the word in the open menu. */
const PINNED_MARKS = {
  [MENU_WIDTHS.icons]: () => <span className={styles.rule} aria-hidden="true" />,
  [MENU_WIDTHS.open]: () => (
    <p className={styles.eyebrow} aria-hidden="true">
      {APP_SHELL_COPY.pinned}
    </p>
  ),
} as const satisfies Record<MenuWidth, ComponentType>

/**
 * The frame around every browsing page. Beside the page, the side menu
 * holds still as the page scrolls: the logo, Home and Favourites, Music
 * (the music mode at `/music`) while a music library exists, then under a
 * Pinned heading the pinned libraries, each with its type's icon
 * (with a lock on it for a locked one, whatever its type), an open one
 * marked instead of Libraries. Libraries and Settings sit at its foot, under
 * a rule and a Manage button that folds them away, open menu or icons alone,
 * then Shortcuts, which never folds, over raven's version and the toggle. The menu collapses to its icons with B or
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
  const hasMusic = !isOffline && musicLibrariesOf(libraries.data ?? []).length > 0
  const PinnedMark = PINNED_MARKS[isIconsOnly ? MENU_WIDTHS.icons : MENU_WIDTHS.open]
  const isPinnedOpen = pinned.some((library) =>
    isAnyOf({ patterns: libraryPages(library.id), pathname }),
  )

  useKeyShortcut({ key: SIDE_MENU_KEY, onPress: isMediumScreen ? ignore : toggle })
  useScrollReset()

  return (
    <div className={collapsed ? `${styles.shell} ${styles.collapsed}` : styles.shell}>
      {!isOffline && <FollowServer />}
      <PageBackdrop />
      <nav
        id={navId}
        className={isFrosted ? `${styles.side} ${styles.frosted}` : styles.side}
        aria-label={APP_SHELL_COPY.main}
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
                label={COMMON_COPY.home}
                isIconsOnly={isIconsOnly}
              />
              {!isDesktop && (
                <NavItem
                  to={BINGE_PATH}
                  patterns={[BINGE_PATH]}
                  icon={<Icon name="playback" />}
                  label={BINGE_COPY.title}
                  isIconsOnly={isIconsOnly}
                />
              )}
              <NavItem
                to="/favourites"
                patterns={['/favourites']}
                icon={<Icon name="heart" />}
                label={COMMON_COPY.favourites}
                isIconsOnly={isIconsOnly}
              />
            </>
          )}
          {hasMusic && (
            <NavItem
              to={MUSIC_PATHS.root}
              patterns={[MUSIC_PATHS.root]}
              icon={<Icon name="music" />}
              label={APP_SHELL_COPY.music}
              isIconsOnly={isIconsOnly}
            />
          )}
          {pinned.length > 0 && (
            <>
              <PinnedMark />
              <ul className={styles.pinned} aria-label={APP_SHELL_COPY.pinned}>
                {pinned.map((library) => (
                  <li key={library.id} className={styles.pinnedItem}>
                    <NavItem
                      to={`/libraries/${library.id}`}
                      patterns={libraryPages(library.id)}
                      icon={<LibraryIcon settings={library.settings} />}
                      label={library.name}
                      isIconsOnly={isIconsOnly}
                      note={library.settings.locked ? APP_SHELL_COPY.locked : undefined}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className={styles.dock}>
          <ManageGroup isIconsOnly={isIconsOnly}>
            {!isOffline && (
              <>
                <NavItem
                  to="/libraries"
                  patterns={isPinnedOpen ? ['/libraries'] : ['/libraries', ...libraryPages(':id')]}
                  icon={<Icon name="libraries" />}
                  label={COMMON_COPY.libraries}
                  isIconsOnly={isIconsOnly}
                />
                <AdminOnly>
                  <NavItem
                    to={ADMIN_PATH}
                    patterns={[ADMIN_PATH]}
                    icon={<Icon name="settings" />}
                    label={ADMIN_COPY.heading}
                    isIconsOnly={isIconsOnly}
                  />
                  <NavItem
                    to="/streams"
                    patterns={['/streams']}
                    icon={<Icon name="playback" />}
                    label={APP_SHELL_COPY.streams}
                    isIconsOnly={isIconsOnly}
                  />
                  <NavItem
                    to="/reports"
                    patterns={['/reports']}
                    icon={<Icon name="alert" />}
                    label={APP_SHELL_COPY.bugReports}
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
              label={COMMON_COPY.settings}
              isIconsOnly={isIconsOnly}
            />
          </ManageGroup>
          <NavItem
            to={PAGE_PATHS.shortcuts}
            patterns={[PAGE_PATHS.shortcuts]}
            icon={<Icon name="keyboard" />}
            label={APP_SHELL_COPY.shortcuts}
            isIconsOnly={isIconsOnly}
          />
          {!isMediumScreen && (
            <div className={styles.foot}>
              <div className={styles.toggle}>
                <Button
                  tone="ghost"
                  icon="sidebar"
                  className={styles.toggleButton}
                  aria-label={APP_SHELL_COPY.sideMenu}
                  aria-expanded={!collapsed}
                  aria-controls={navId}
                  aria-keyshortcuts="B"
                  title={
                    collapsed ? APP_SHELL_COPY.expandSideMenu : APP_SHELL_COPY.collapseSideMenu
                  }
                  onClick={toggle}
                />
                {!tipSeen && <ShortcutTip onDismiss={dismissTip} />}
              </div>
              {!collapsed && (
                <p className={styles.version}>{APP_SHELL_COPY.version(ravenVersion)}</p>
              )}
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
      <TabBar hasMusic={hasMusic} />
    </div>
  )
}
