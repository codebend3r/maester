import { DESKTOP_PATHS, PAGE_PATHS } from '@raven/core'
import { Icon, type IconName } from '@raven/ui'
import { Link } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { libraryPages, useIsCurrent } from '@/components/AppShell/currentPage'
import { useComputerName, useIsDesktop } from '@/stores/desktop'
import { useServerReach } from '@/stores/serverReach'
import styles from '@/components/AppShell/TabBar.module.scss'

type TabProps = {
  to: string
  patterns: readonly string[]
  icon: IconName
  label: string
}

/** A tab: its icon over its name, marked as current when the location matches any of its patterns. */
const Tab = ({ to, patterns, icon, label }: TabProps) => {
  const isCurrent = useIsCurrent(patterns)
  return (
    <Link to={to} className={styles.tab} aria-current={isCurrent ? 'page' : undefined}>
      <Icon name={icon} size={22} />
      <span className={styles.label}>{label}</span>
    </Link>
  )
}

/**
 * A phone's way round, in place of the side menu: Home, Libraries,
 * Favourites and Settings along the foot of the screen, with Streams and
 * Reports between them for whoever may manage. The pinned
 * libraries are reached from Libraries, so any library's pages mark it.
 * A narrow Raven window adds On this Mac and Downloads before
 * Settings, and keeps only those three while it cannot reach its server.
 */
export const TabBar = () => {
  const isDesktop = useIsDesktop()
  const computer = useComputerName()
  const isOffline = useServerReach((state) => state.isOffline)
  return (
    <nav className={styles.tabs} aria-label="Tabs">
      {!isOffline && (
        <>
          <Tab to="/" patterns={['/']} icon="home" label="Home" />
          <Tab
            to="/libraries"
            patterns={['/libraries', ...libraryPages(':id')]}
            icon="libraries"
            label="Libraries"
          />
          <Tab to="/favourites" patterns={['/favourites']} icon="heart" label="Favourites" />
          <AdminOnly>
            <Tab to="/streams" patterns={['/streams']} icon="playback" label="Streams" />
            <Tab to="/reports" patterns={['/reports']} icon="alert" label="Reports" />
          </AdminOnly>
        </>
      )}
      {isDesktop && (
        <>
          <Tab
            to={DESKTOP_PATHS.local}
            patterns={[DESKTOP_PATHS.local]}
            icon="file-play"
            label={`This ${computer}`}
          />
          <Tab
            to={DESKTOP_PATHS.downloads}
            patterns={[DESKTOP_PATHS.downloads]}
            icon="download"
            label="Downloads"
          />
        </>
      )}
      <Tab
        to={PAGE_PATHS.settings}
        patterns={[PAGE_PATHS.settings]}
        icon="settings"
        label="Settings"
      />
    </nav>
  )
}
