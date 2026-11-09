import { DESKTOP_PATHS, PAGE_PATHS } from '@raven/core'
import { type ComponentType, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { APP_SHELL_COPY } from '@/components/AppShell/copy'
import { isAnyOf, libraryPages } from '@/components/AppShell/currentPage'
import { MoreSheet } from '@/components/AppShell/MoreSheet'
import { Tab, TabButton, TabStrip, type TabTarget } from '@/components/TabStrip/TabStrip'
import { useComputerName, useIsDesktop } from '@/stores/desktop'
import { useServerReach } from '@/stores/serverReach'
import { COMMON_COPY } from '@/lib/copy'
import { BINGE_COPY, BINGE_PATH } from '@/lib/binge'
import { PLAY_HISTORY_ROUTES } from '@/lib/playHistory'
import { NOTIFICATIONS_PATH } from '@/lib/notifications'
import { NOTIFICATIONS_COPY } from '@/pages/NotificationsPage/copy'
import { PLAY_HISTORY_COPY } from '@/pages/PlayHistoryPage/copy'
import { ADMIN_COPY, ADMIN_PATH } from '@/pages/SettingsPage/adminCopy'
import { MUSIC_PATHS } from '@/lib/music'

const HOME_TAB = {
  to: '/',
  patterns: ['/'],
  icon: 'home',
  label: COMMON_COPY.home,
} as const satisfies TabTarget

const LIBRARIES_TAB = {
  to: '/libraries',
  patterns: ['/libraries', ...libraryPages(':id')],
  icon: 'libraries',
  label: COMMON_COPY.libraries,
} as const satisfies TabTarget

const FAVOURITES_TAB = {
  to: '/favourites',
  patterns: ['/favourites'],
  icon: 'heart',
  label: COMMON_COPY.favourites,
} as const satisfies TabTarget

const MUSIC_TAB = {
  to: MUSIC_PATHS.root,
  patterns: [MUSIC_PATHS.root],
  icon: 'music',
  label: APP_SHELL_COPY.music,
} as const satisfies TabTarget

const BINGE_TAB = {
  to: BINGE_PATH,
  patterns: [BINGE_PATH],
  icon: 'popcorn',
  label: BINGE_COPY.title,
} as const satisfies TabTarget

const HISTORY_TAB = {
  to: PLAY_HISTORY_ROUTES.own,
  patterns: [PLAY_HISTORY_ROUTES.own, PLAY_HISTORY_ROUTES.everyone],
  icon: 'history',
  label: PLAY_HISTORY_COPY.title,
} as const satisfies TabTarget

const NOTIFICATIONS_TAB = {
  to: NOTIFICATIONS_PATH,
  patterns: [NOTIFICATIONS_PATH],
  icon: 'bell',
  label: NOTIFICATIONS_COPY.title,
} as const satisfies TabTarget

const DOWNLOADS_TAB = {
  to: DESKTOP_PATHS.downloads,
  patterns: [DESKTOP_PATHS.downloads],
  icon: 'download',
  label: COMMON_COPY.downloads,
} as const satisfies TabTarget

const SETTINGS_TAB = {
  to: PAGE_PATHS.settings,
  patterns: [PAGE_PATHS.settings],
  icon: 'settings',
  label: COMMON_COPY.settings,
} as const satisfies TabTarget

const MANAGE_TABS = [
  { to: ADMIN_PATH, patterns: [ADMIN_PATH], icon: 'settings', label: ADMIN_COPY.heading },
  { to: '/streams', patterns: ['/streams'], icon: 'playback', label: APP_SHELL_COPY.streams },
  { to: '/reports', patterns: ['/reports'], icon: 'alert', label: APP_SHELL_COPY.reports },
] as const satisfies readonly TabTarget[]

/** Raven's own pages, the files on this computer and the downloads, which need no server. */
const useDesktopTabs = (): readonly TabTarget[] => {
  const isDesktop = useIsDesktop()
  const computer = useComputerName()
  if (!isDesktop) return []
  return [
    {
      to: DESKTOP_PATHS.local,
      patterns: [DESKTOP_PATHS.local],
      icon: 'file-play',
      label: APP_SHELL_COPY.thisComputer(computer),
    },
    DOWNLOADS_TAB,
  ]
}

type TabBarProps = {
  /** Whether a music library exists, so the tabs offer the music mode. */
  hasMusic: boolean
}

/** While Raven cannot reach its server: the pages that need none, with no More. */
const OfflineTabBar = () => {
  const desktopTabs = useDesktopTabs()
  return (
    <TabStrip label={APP_SHELL_COPY.tabs}>
      {[...desktopTabs, SETTINGS_TAB].map((tab) => (
        <Tab key={tab.to} {...tab} />
      ))}
    </TabStrip>
  )
}

const OnlineTabBar = ({ hasMusic }: TabBarProps) => {
  const { pathname } = useLocation()
  const desktopTabs = useDesktopTabs()
  const moreButton = useRef<HTMLButtonElement>(null)
  const [openedOn, setOpenedOn] = useState<string | null>(null)
  // A new page closes the sheet, whichever way it came.
  if (openedOn !== null && openedOn !== pathname) setOpenedOn(null)
  const isOpen = openedOn === pathname

  // Music takes Binge's slot while a music library exists, and Binge moves into More.
  const [fourthTab, ...displaced] = hasMusic
    ? ([MUSIC_TAB, BINGE_TAB] as const)
    : ([BINGE_TAB] as const)
  const moreTabs = [...displaced, HISTORY_TAB, NOTIFICATIONS_TAB, ...desktopTabs, SETTINGS_TAB]
  const isMoreCurrent = isAnyOf({
    patterns: [...moreTabs, ...MANAGE_TABS].flatMap((tab) => tab.patterns),
    pathname,
  })
  const closeMore = () => {
    setOpenedOn(null)
    moreButton.current?.focus()
  }
  const leaveMore = () => setOpenedOn(null)

  return (
    <>
      <TabStrip label={APP_SHELL_COPY.tabs}>
        {[HOME_TAB, LIBRARIES_TAB, FAVOURITES_TAB, fourthTab].map((tab) => (
          <Tab key={tab.to} {...tab} />
        ))}
        <TabButton
          ref={moreButton}
          icon="more"
          label={APP_SHELL_COPY.more}
          isMarked={isOpen || isMoreCurrent}
          isExpanded={isOpen}
          onClick={() => setOpenedOn(pathname)}
        />
      </TabStrip>
      {isOpen && (
        <MoreSheet
          entries={moreTabs}
          manageEntries={MANAGE_TABS}
          onClose={closeMore}
          onChoose={leaveMore}
        />
      )}
    </>
  )
}

const REACH_KINDS = { online: 'online', offline: 'offline' } as const
type ReachKind = (typeof REACH_KINDS)[keyof typeof REACH_KINDS]

const TAB_BARS = {
  [REACH_KINDS.online]: OnlineTabBar,
  [REACH_KINDS.offline]: OfflineTabBar,
} as const satisfies Record<ReachKind, ComponentType<TabBarProps>>

/**
 * A phone's way round, in place of the side menu: five tabs along the foot
 * of the screen. Home, Libraries (which any library's pages mark),
 * Favourites, Music while a music library exists or else Binge, then More,
 * which opens a sheet of the rest: Binge when Music took its place, Play
 * history, Notifications, On this Mac and Downloads in Raven, Settings, and for whoever may
 * manage, Admin, Streams and Reports. More is marked while its sheet is open
 * or one of its pages is. The sheet closes on a choice, Escape, a tap on the
 * page or a new page. While Raven cannot reach its server, the bar keeps only
 * On this Mac, Downloads and Settings, with no More.
 */
export const TabBar = ({ hasMusic }: TabBarProps) => {
  const isOffline = useServerReach((state) => state.isOffline)
  const Bar = TAB_BARS[isOffline ? REACH_KINDS.offline : REACH_KINDS.online]
  return <Bar hasMusic={hasMusic} />
}
