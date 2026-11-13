import { DESKTOP_PATHS } from '@raven/core'
import { type ComponentType, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { APP_SHELL_COPY } from '@/components/AppShell/copy'
import { isAnyOf } from '@/components/AppShell/currentPage'
import { MoreSheet } from '@/components/AppShell/MoreSheet'
import { NAV_PLACES } from '@/components/AppShell/navPlaces'
import { Tab, TabButton, TabStrip, type TabTarget } from '@/components/TabStrip/TabStrip'
import { APP_PATHS } from '@/lib/appPaths'
import { useComputerName, useIsDesktop } from '@/stores/desktop'
import { useDownloadsHostOrNone } from '@/stores/downloadsHost'
import { useServerReach } from '@/stores/serverReach'

/** History marks both its pages here, since everyone's has no tab of its own. */
const HISTORY_TAB = {
  ...NAV_PLACES.history,
  patterns: [APP_PATHS.history, APP_PATHS.everyonesHistory],
} as const satisfies TabTarget

const MANAGE_TABS = [
  NAV_PLACES.admin,
  NAV_PLACES.streams,
  { ...NAV_PLACES.reports, label: APP_SHELL_COPY.reports },
] as const satisfies readonly TabTarget[]

/*
 * The pages that need no server: Raven's files on this computer, and the downloads wherever the
 * page keeps any, inside Raven or in a browser that can.
 */
const useHostTabs = (): readonly TabTarget[] => {
  const isDesktop = useIsDesktop()
  const hasDownloads = useDownloadsHostOrNone() !== null
  const computer = useComputerName()
  const local = {
    to: DESKTOP_PATHS.local,
    patterns: [DESKTOP_PATHS.local],
    icon: 'file-play',
    label: APP_SHELL_COPY.thisComputer(computer),
  } as const satisfies TabTarget
  return [...(isDesktop ? [local] : []), ...(hasDownloads ? [NAV_PLACES.downloads] : [])]
}

type TabBarProps = {
  /** Whether a music library exists, so the tabs offer the music mode. */
  hasMusic: boolean
}

/** While Raven cannot reach its server: the pages that need none, with no More. */
const OfflineTabBar = () => {
  const hostTabs = useHostTabs()
  return (
    <TabStrip label={APP_SHELL_COPY.tabs}>
      {[...hostTabs, NAV_PLACES.settings].map((tab) => (
        <Tab key={tab.to} {...tab} />
      ))}
    </TabStrip>
  )
}

const OnlineTabBar = ({ hasMusic }: TabBarProps) => {
  const { pathname } = useLocation()
  const hostTabs = useHostTabs()
  const moreButton = useRef<HTMLButtonElement>(null)
  const [openedOn, setOpenedOn] = useState<string | null>(null)
  // A new page closes the sheet, whichever way it came.
  if (openedOn !== null && openedOn !== pathname) setOpenedOn(null)
  const isOpen = openedOn === pathname

  // Music takes Binge's slot while a music library exists, and Binge moves into More.
  const [fourthTab, ...displaced] = hasMusic
    ? ([NAV_PLACES.music, NAV_PLACES.binge] as const)
    : ([NAV_PLACES.binge] as const)
  const moreTabs = [
    ...displaced,
    NAV_PLACES.comingSoon,
    HISTORY_TAB,
    NAV_PLACES.notifications,
    ...hostTabs,
    NAV_PLACES.settings,
  ]
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
        {[NAV_PLACES.home, NAV_PLACES.libraries, NAV_PLACES.favourites, fourthTab].map((tab) => (
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
 * which opens a sheet of the rest: Binge when Music took its place, Coming soon, Play
 * history, Notifications, On this Mac in Raven, Downloads wherever the page keeps any, Settings,
 * and for whoever may manage, Admin, Streams and Reports. More is marked while its sheet is open
 * or one of its pages is. The sheet closes on a choice, Escape, a tap on the
 * page or a new page. While the server cannot be reached, the bar keeps only
 * On this Mac, Downloads and Settings, with no More.
 */
export const TabBar = ({ hasMusic }: TabBarProps) => {
  const isOffline = useServerReach((state) => state.isOffline)
  const Bar = TAB_BARS[isOffline ? REACH_KINDS.offline : REACH_KINDS.online]
  return <Bar hasMusic={hasMusic} />
}
