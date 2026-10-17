import { Icon, type IconName } from '@raven/ui'
import { Link } from 'react-router-dom'
import { libraryPages, useIsCurrent } from '@/components/AppShell/currentPage'
import styles from '@/components/AppShell/TabBar.module.scss'

/** A tab: its icon over its name, marked as current when the location matches any of its patterns. */
const Tab = ({
  to,
  patterns,
  icon,
  label,
}: {
  to: string
  patterns: readonly string[]
  icon: IconName
  label: string
}) => {
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
 * Favourites and Settings along the foot of the screen. The pinned
 * libraries are reached from Libraries, so any library's pages mark it.
 */
export const TabBar = () => (
  <nav className={styles.tabs} aria-label="Tabs">
    <Tab to="/" patterns={['/']} icon="home" label="Home" />
    <Tab
      to="/libraries"
      patterns={['/libraries', ...libraryPages(':id')]}
      icon="libraries"
      label="Libraries"
    />
    <Tab to="/favourites" patterns={['/favourites']} icon="heart" label="Favourites" />
    <Tab to="/settings" patterns={['/settings']} icon="settings" label="Settings" />
  </nav>
)
