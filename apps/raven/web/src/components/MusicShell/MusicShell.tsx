import { Icon, type IconName } from '@raven/ui'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { AccountMenu } from '@/components/AccountMenu/AccountMenu'
import { FollowServer } from '@/components/AppShell/FollowServer'
import { useIsCurrent } from '@/components/AppShell/currentPage'
import { HOME } from '@/components/BackButton/BackButton'
import { Logo } from '@/components/Logo/Logo'
import { MUSIC_SHELL_COPY } from '@/components/MusicShell/copy'
import { Tab, TabStrip } from '@/components/TabStrip/TabStrip'
import { ThemePicker } from '@/components/ThemePicker/ThemePicker'
import { MUSIC_PATHS } from '@/lib/music'
import { TopCardNote, useScrollReset } from '@/lib/useScrollReset'
import { useIsDesktop } from '@/stores/desktop'
import { useServerReach } from '@/stores/serverReach'
import styles from '@/components/MusicShell/MusicShell.module.scss'

/** One of the music mode's places, in the side menu and the tab bar alike. */
type MusicPlace = {
  to: string
  /** The pages that mark it as current. */
  patterns: readonly string[]
  icon: IconName
  label: string
}

const HOME_PLACE = {
  to: MUSIC_PATHS.root,
  patterns: [MUSIC_PATHS.root, MUSIC_PATHS.mix, MUSIC_PATHS.nowPlaying],
  icon: 'home',
  label: MUSIC_SHELL_COPY.home,
} as const satisfies MusicPlace

const LIBRARY_PLACE = {
  to: MUSIC_PATHS.albums,
  patterns: [
    MUSIC_PATHS.albums,
    MUSIC_PATHS.artists,
    MUSIC_PATHS.songs,
    MUSIC_PATHS.playlists,
    MUSIC_PATHS.album,
    MUSIC_PATHS.artist,
    MUSIC_PATHS.playlist,
  ],
  icon: 'libraries',
  label: MUSIC_SHELL_COPY.library,
} as const satisfies MusicPlace

const SEARCH_PLACE = {
  to: MUSIC_PATHS.search,
  patterns: [MUSIC_PATHS.search],
  icon: 'search',
  label: MUSIC_SHELL_COPY.search,
} as const satisfies MusicPlace

const DOWNLOADS_PLACE = {
  to: MUSIC_PATHS.downloads,
  patterns: [MUSIC_PATHS.downloads],
  icon: 'download',
  label: MUSIC_SHELL_COPY.downloads,
} as const satisfies MusicPlace

type PlacesForProps = { isOffline: boolean; isDesktop: boolean }

/** The places open now: those that need the server while it is in reach, and Raven's downloads. */
const placesFor = ({ isOffline, isDesktop }: PlacesForProps): readonly MusicPlace[] => [
  ...(isOffline ? [] : [HOME_PLACE, LIBRARY_PLACE, SEARCH_PLACE]),
  ...(isDesktop ? [DOWNLOADS_PLACE] : []),
]

type PlaceLinkProps = { place: MusicPlace }

/** A place's link in the side menu: its icon and name, marked as current on any of its pages. */
const PlaceLink = ({ place }: PlaceLinkProps) => {
  const isCurrent = useIsCurrent(place.patterns)
  return (
    <Link to={place.to} className={styles.navLink} aria-current={isCurrent ? 'page' : undefined}>
      <Icon name={place.icon} />
      <span className={styles.label}>{place.label}</span>
    </Link>
  )
}

/**
 * The music mode's frame, over the same player as raven's own: a side menu
 * of Home, Library, Search and, in Raven, Downloads, with Back to raven at
 * its foot; the theme and account buttons over the page; and on a phone a
 * tab bar along the foot of the screen in the side menu's place. While
 * Raven cannot reach its server, only Downloads and the way back stay.
 */
export const MusicShell = () => {
  const { key } = useLocation()
  const isDesktop = useIsDesktop()
  const isOffline = useServerReach((state) => state.isOffline)
  const places = placesFor({ isOffline, isDesktop })
  useScrollReset()

  return (
    <div className={styles.shell}>
      {!isOffline && <FollowServer />}
      <nav className={styles.side} aria-label={MUSIC_SHELL_COPY.music}>
        <Link
          to={MUSIC_PATHS.root}
          className={styles.brand}
          aria-label={MUSIC_SHELL_COPY.musicHome}
        >
          <Logo />
          <span className={styles.mode} aria-hidden="true">
            {MUSIC_SHELL_COPY.music}
          </span>
        </Link>
        <ul className={styles.links}>
          {places.map((place) => (
            <li key={place.to} className={styles.item}>
              <PlaceLink place={place} />
            </li>
          ))}
        </ul>
        <Link to={HOME.to} className={`${styles.navLink} ${styles.back}`}>
          <Icon name="back" />
          <span className={styles.label}>{MUSIC_SHELL_COPY.backToRaven}</span>
        </Link>
      </nav>
      <main className={styles.main}>
        <div className={styles.corner}>
          <ThemePicker />
          {!isOffline && <AccountMenu />}
        </div>
        <div className={styles.page}>
          <TopCardNote pageKey={key}>
            <Outlet />
          </TopCardNote>
        </div>
      </main>
      <TabStrip label={MUSIC_SHELL_COPY.tabs}>
        {places.map((place) => (
          <Tab
            key={place.to}
            to={place.to}
            patterns={place.patterns}
            icon={place.icon}
            label={place.label}
          />
        ))}
        <Tab
          to={HOME.to}
          patterns={[]}
          icon="back"
          label={MUSIC_SHELL_COPY.raven}
          accessibleName={MUSIC_SHELL_COPY.backToRaven}
        />
      </TabStrip>
    </div>
  )
}
