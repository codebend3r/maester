import { Icon } from '@raven/ui'
import { Link } from 'react-router-dom'
import styles from '@/components/AppShell/BrowseBar.module.scss'
import { APP_SHELL_COPY } from '@/components/AppShell/copy'
import { useIsCurrent } from '@/components/AppShell/currentPage'
import { NAV_PLACES } from '@/components/AppShell/navPlaces'
import { NavTip } from '@/components/AppShell/NavTip'
import { useIsMediumScreen } from '@/components/AppShell/useIsMediumScreen'
import type { TabTarget } from '@/components/TabStrip/TabStrip'

type BrowseLinkProps = { place: TabTarget; isIconsOnly: boolean }

/** One browsing place: its icon and name, down to the icon on a medium screen, where the name shows as a tooltip. */
const BrowseLink = ({ place, isIconsOnly }: BrowseLinkProps) => {
  const isCurrent = useIsCurrent(place.patterns)
  return (
    <li>
      <NavTip text={place.label} isOn={isIconsOnly}>
        {(handlers) => (
          <Link
            to={place.to}
            className={styles.place}
            aria-current={isCurrent ? 'page' : undefined}
            {...handlers}
          >
            <Icon name={place.icon} />
            <span className={isIconsOnly ? 'visually-hidden' : styles.label}>{place.label}</span>
          </Link>
        )}
      </NavTip>
    </li>
  )
}

/** The browsing places every page shows along its top, while the server is in reach. */
const BROWSE_PLACES = [
  NAV_PLACES.continueWatching,
  NAV_PLACES.binge,
  NAV_PLACES.comingSoon,
  NAV_PLACES.favourites,
] as const satisfies readonly TabTarget[]

type BrowseBarProps = {
  /** Whether a music library exists, so the row ends with the music mode. */
  hasMusic: boolean
}

/**
 * The browsing places in a row along the top of the page, level with the
 * theme and account buttons, in raven's frame and the music mode's alike.
 * A medium screen keeps the icons alone.
 */
export const BrowseBar = ({ hasMusic }: BrowseBarProps) => {
  const isIconsOnly = useIsMediumScreen()
  return (
    <nav className={styles.bar} aria-label={APP_SHELL_COPY.browse}>
      <ul className={styles.places}>
        {(hasMusic ? [...BROWSE_PLACES, NAV_PLACES.music] : BROWSE_PLACES).map((place) => (
          <BrowseLink key={place.to} place={place} isIconsOnly={isIconsOnly} />
        ))}
      </ul>
    </nav>
  )
}
