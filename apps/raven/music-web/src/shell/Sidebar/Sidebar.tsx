import { classNames } from '@raven/ui/headless'
import { LIBRARY_PAGE_COPY } from '@raven/wren'
import { WrenLockup } from '@/components/WrenLockup/WrenLockup'
import { useShownPath } from '@/shell/chrome'
import { LIBRARY_PLACES, type Place, TAB_PLACES } from '@/shell/places'
import { SIZES } from '@/theme/tokens'
import { Pressable } from '@/ui/Pressable/Pressable'
import { ServerStatusChip } from '@/ui/ServerStatusChip/ServerStatusChip'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/shell/Sidebar/Sidebar.module.scss'

/** Home and Search, at the sidebar's top. */
const TOP_PLACES = [TAB_PLACES.home, TAB_PLACES.search] as const

type SidebarItemProps = { place: Place }

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
 * The wide layout's sidebar: the lockup, Home and Search, Library's categories, then Settings
 * and the server's status at its foot. At `64rem` and narrower it folds to a rail of icons, each
 * still named for a screen reader, as the apps' does on an upright tablet.
 */
export function Sidebar() {
  return (
    <nav className={styles.sidebar}>
      <div className={styles.places}>
        <span className={styles.lockup}>
          <WrenLockup size={SIZES.lockup} />
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
      </div>
    </nav>
  )
}
