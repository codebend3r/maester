import { DESKTOP_PATHS, musicLibrariesOf, libraryPath } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { type ComponentType, type ReactNode, useId } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BUTTON_TONES, Button, Icon, type IconName, useKeyShortcut } from '@raven/ui'
import { AccountMenu } from '@/components/AccountMenu/AccountMenu'
import { ShellOutlet } from '@/components/ShellOutlet/ShellOutlet'
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
import { SiteSearch } from '@/components/SiteSearch/SiteSearch'
import { ThemePicker } from '@/components/ThemePicker/ThemePicker'
import { librariesQuery } from '@/lib/queries'
import { useScrollReset } from '@/lib/useScrollReset'
import { ravenVersion } from '@/lib/version'
import { useInProgressCount } from '@/desktop/downloadsApi'
import { usePageBackdrop } from '@raven/ui/headless'
import { BROWSER_PLAY_PATH } from '@/browserDownloads/paths'
import { useComputerName, useIsDesktop } from '@/stores/desktop'
import { useDownloadsHostOrNone } from '@/stores/downloadsHost'
import { useServerReach } from '@/stores/serverReach'
import { SIDE_MENU_KEY, useSideMenu } from '@/stores/sideMenu'
import styles from '@/components/AppShell/AppShell.module.scss'
import { NAV_PLACES } from '@/components/AppShell/navPlaces'
import type { TabTarget } from '@/components/TabStrip/TabStrip'
import { APP_PATHS } from '@/lib/appPaths'

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

type NavItemsProps = { places: readonly TabTarget[]; isIconsOnly: boolean }

/** Rows of the side menu, one for each place, in the order given. */
const NavItems = ({ places, isIconsOnly }: NavItemsProps) =>
  places.map((place) => (
    <NavItem
      key={place.to}
      to={place.to}
      patterns={place.patterns}
      icon={<Icon name={place.icon} />}
      label={place.label}
      isIconsOnly={isIconsOnly}
    />
  ))

/** The browsing places at the side menu's head, while the server is in reach. */
const BROWSE_PLACES = [
  NAV_PLACES.home,
  NAV_PLACES.continueWatching,
  NAV_PLACES.binge,
  NAV_PLACES.comingSoon,
  NAV_PLACES.favourites,
] as const satisfies readonly TabTarget[]

/** Libraries while a pinned library is open, which that library's own row marks instead. */
const PINNED_LIBRARIES = {
  ...NAV_PLACES.libraries,
  patterns: [NAV_PLACES.libraries.to],
} as const satisfies TabTarget

/** What only whoever may manage sees, under Libraries. */
const MANAGE_PLACES = [
  NAV_PLACES.admin,
  NAV_PLACES.streams,
  NAV_PLACES.reports,
  NAV_PLACES.everyonesHistory,
] as const satisfies readonly TabTarget[]

/** The account's own pages that need the server. */
const ACCOUNT_PLACES = [
  NAV_PLACES.history,
  NAV_PLACES.notifications,
] as const satisfies readonly TabTarget[]

/** What every frame keeps, the server in reach or not. */
const APP_PLACES = [
  NAV_PLACES.settings,
  NAV_PLACES.shortcuts,
] as const satisfies readonly TabTarget[]

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

type HostNavItemProps = { isIconsOnly: boolean }

type LocalNavItemProps = HostNavItemProps

/** Raven's own row: the files on this computer. */
const LocalNavItem = ({ isIconsOnly }: LocalNavItemProps) => {
  const computer = useComputerName()
  return (
    <NavItem
      to={DESKTOP_PATHS.local}
      patterns={[DESKTOP_PATHS.local]}
      icon={<Icon name="file-play" />}
      label={APP_SHELL_COPY.onThisComputer(computer)}
      isIconsOnly={isIconsOnly}
    />
  )
}

type DownloadsNavItemProps = HostNavItemProps

/** The downloads' row, where the page keeps any, with how many are under way. */
const DownloadsNavItem = ({ isIconsOnly }: DownloadsNavItemProps) => {
  const inProgress = useInProgressCount()
  return (
    <NavItem
      to={NAV_PLACES.downloads.to}
      patterns={[NAV_PLACES.downloads.to, BROWSER_PLAY_PATH]}
      icon={<CountedIcon icon={NAV_PLACES.downloads.icon} count={inProgress} />}
      label={NAV_PLACES.downloads.label}
      isIconsOnly={isIconsOnly}
      note={inProgress > 0 ? APP_SHELL_COPY.inProgress(inProgress) : undefined}
    />
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
 * holds still as the page scrolls: the logo, Home, Continue watching, Binge,
 * Coming soon (what TMDB says is on its way) and Favourites, Music
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
  const hasDownloads = useDownloadsHostOrNone() !== null
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
        <Link to={APP_PATHS.home} className={styles.home}>
          <Logo isMarkOnly={isIconsOnly} />
        </Link>
        <div className={styles.links}>
          {!isOffline && <NavItems places={BROWSE_PLACES} isIconsOnly={isIconsOnly} />}
          {hasMusic && <NavItems places={[NAV_PLACES.music]} isIconsOnly={isIconsOnly} />}
          {pinned.length > 0 && (
            <>
              <PinnedMark />
              <ul className={styles.pinned} aria-label={APP_SHELL_COPY.pinned}>
                {pinned.map((library) => (
                  <li key={library.id} className={styles.pinnedItem}>
                    <NavItem
                      to={libraryPath(library.id)}
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
                <NavItems
                  places={[isPinnedOpen ? PINNED_LIBRARIES : NAV_PLACES.libraries]}
                  isIconsOnly={isIconsOnly}
                />
                <AdminOnly>
                  <NavItems places={MANAGE_PLACES} isIconsOnly={isIconsOnly} />
                </AdminOnly>
                <NavItems places={ACCOUNT_PLACES} isIconsOnly={isIconsOnly} />
              </>
            )}
            {isDesktop && <LocalNavItem isIconsOnly={isIconsOnly} />}
            {hasDownloads && <DownloadsNavItem isIconsOnly={isIconsOnly} />}
            <NavItems places={APP_PLACES} isIconsOnly={isIconsOnly} />
            <AdminOnly>
              <NavItems places={[NAV_PLACES.design]} isIconsOnly={isIconsOnly} />
            </AdminOnly>
          </ManageGroup>
          {!isMediumScreen && (
            <div className={styles.foot}>
              <div className={styles.toggle}>
                <Button
                  tone={BUTTON_TONES.ghost}
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
          <ShellOutlet pageKey={key} />
        </div>
      </main>
      <TabBar hasMusic={hasMusic} />
    </div>
  )
}
