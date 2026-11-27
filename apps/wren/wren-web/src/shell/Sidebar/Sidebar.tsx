import { useKeyShortcut } from '@raven/ui'
import { classNames } from '@raven/ui/headless'
import {
  LIBRARY_PAGE_COPY,
  SETTINGS_COPY,
  SIDEBAR_COPY,
  SIDEBAR_KEY,
  WREN_ICONS,
} from '@raven/wren'
import type { ComponentType } from 'react'
import { WrenLockup, WrenMark } from '@/components/WrenLockup/WrenLockup'
import { wrenVersion } from '@/lib/version'
import { useShownPath } from '@/shell/chrome'
import { LIBRARY_PLACES, type Place, TAB_PLACES } from '@/shell/places'
import { useSidebar } from '@/stores/sidebar'
import { MEDIA_QUERIES, useMatchesMedia } from '@/theme/media'
import { SIZES } from '@/theme/tokens'
import { Pressable } from '@/ui/Pressable/Pressable'
import { ServerStatusChip } from '@/ui/ServerStatusChip/ServerStatusChip'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/shell/Sidebar/Sidebar.module.scss'

const SIDEBAR_ID = 'sidebar'

/** Home and Search, at the sidebar's top. */
const TOP_PLACES = [TAB_PLACES.home, TAB_PLACES.search] as const

type SidebarItemProps = { place: Place }

/** What the sidebar's logo row shows: the whole lockup, or the bird alone. */
const LOGO_VIEWS = { lockup: 'lockup', mark: 'mark' } as const

type LogoView = (typeof LOGO_VIEWS)[keyof typeof LOGO_VIEWS]

function SidebarMark() {
  return <WrenMark size={SIZES.largeIcon} />
}

function SidebarLockup() {
  return <WrenLockup size={SIZES.lockup} />
}

const LOGOS = {
  [LOGO_VIEWS.lockup]: SidebarLockup,
  [LOGO_VIEWS.mark]: SidebarMark,
} as const satisfies Record<LogoView, ComponentType>

type SidebarLogoProps = { isMarkOnly: boolean }

/** The lockup, or the bird alone once the sidebar is down to its icons: the same row either way. */
function SidebarLogo({ isMarkOnly }: SidebarLogoProps) {
  const Logo = LOGOS[isMarkOnly ? LOGO_VIEWS.mark : LOGO_VIEWS.lockup]
  return <Logo />
}

/** One of the sidebar's places, bright on a soft red ground while it is the page showing. */
function SidebarItem({ place }: SidebarItemProps) {
  const isActive = useShownPath() === place.path
  return (
    <Pressable
      className={classNames([styles.item, isActive && styles.active])}
      href={place.path}
      isCurrent={isActive}
      label={place.label}
    >
      <WrenIcon name={place.icon} size={SIZES.navIcon} />
      <span className={styles.label}>{place.label}</span>
    </Pressable>
  )
}

/**
 * The wide layout's sidebar: the lockup, Home and Search, Library's categories, then Settings,
 * the server's status and, at its foot, the toggle with Wren's version beside it. B or the
 * toggle folds it to a rail of icons, kept across visits, as raven's side menu does. At `64rem`
 * and narrower it is that rail whatever the toggle says, and the toggle and B do nothing, as the
 * apps' does on an upright tablet.
 */
export function Sidebar() {
  const isCollapsed = useSidebar((state) => state.isCollapsed)
  const toggle = useSidebar((state) => state.toggle)
  const isRailed = useMatchesMedia({ query: MEDIA_QUERIES.rail })
  useKeyShortcut({ key: SIDEBAR_KEY, onPress: toggle, isEnabled: !isRailed })
  return (
    <nav className={classNames([styles.sidebar, isCollapsed && styles.collapsed])} id={SIDEBAR_ID}>
      <div className={styles.places}>
        <span className={styles.lockup}>
          <SidebarLogo isMarkOnly={isCollapsed || isRailed} />
        </span>
        {TOP_PLACES.map((place) => (
          <SidebarItem key={place.path} place={place} />
        ))}
        <h2 className={styles.overline}>{LIBRARY_PAGE_COPY.title}</h2>
        {LIBRARY_PLACES.map((place) => (
          <SidebarItem key={place.path} place={place} />
        ))}
      </div>
      <div className={styles.foot}>
        <SidebarItem place={TAB_PLACES.settings} />
        <span className={styles.status}>
          <ServerStatusChip />
        </span>
        {!isRailed && (
          <div className={styles.toggleRow}>
            <button
              aria-controls={SIDEBAR_ID}
              aria-expanded={!isCollapsed}
              aria-keyshortcuts={SIDEBAR_COPY.key}
              aria-label={SIDEBAR_COPY.name}
              className={styles.toggle}
              onClick={toggle}
              title={isCollapsed ? SIDEBAR_COPY.expand : SIDEBAR_COPY.collapse}
              type="button"
            >
              <WrenIcon name={WREN_ICONS.sidebar} size={SIZES.navIcon} />
            </button>
            {!isCollapsed && (
              <p className={styles.version}>{SETTINGS_COPY.versionOf(wrenVersion)}</p>
            )}
          </div>
        )}
      </div>
    </nav>
  )
}
