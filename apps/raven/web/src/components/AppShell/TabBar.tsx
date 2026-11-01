import { DESKTOP_PATHS, PAGE_PATHS } from '@raven/core'
import { APP_SHELL_COPY } from '@/components/AppShell/copy'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { libraryPages } from '@/components/AppShell/currentPage'
import { Tab, TabStrip } from '@/components/TabStrip/TabStrip'
import { useComputerName, useIsDesktop } from '@/stores/desktop'
import { useServerReach } from '@/stores/serverReach'
import { COMMON_COPY } from '@/lib/copy'
import { BINGE_COPY, BINGE_PATH } from '@/lib/binge'
import { ADMIN_COPY, ADMIN_PATH } from '@/pages/SettingsPage/adminCopy'
import { MUSIC_PATHS } from '@/lib/music'

type TabBarProps = {
  /** Whether a music library exists, so the tabs offer the music mode. */
  hasMusic: boolean
}

/**
 * A phone's way round, in place of the side menu: Home, Libraries,
 * Favourites, Music while a music library exists, and Settings along the
 * foot of the screen, with Streams and
 * Reports between them for whoever may manage. The pinned
 * libraries are reached from Libraries, so any library's pages mark it.
 * A narrow Raven window adds On this Mac and Downloads before
 * Settings, and keeps only those three while it cannot reach its server.
 */
export const TabBar = ({ hasMusic }: TabBarProps) => {
  const isDesktop = useIsDesktop()
  const computer = useComputerName()
  const isOffline = useServerReach((state) => state.isOffline)
  return (
    <TabStrip label={APP_SHELL_COPY.tabs}>
      {!isOffline && (
        <>
          <Tab to="/" patterns={['/']} icon="home" label={COMMON_COPY.home} />
          <Tab
            to="/libraries"
            patterns={['/libraries', ...libraryPages(':id')]}
            icon="libraries"
            label={COMMON_COPY.libraries}
          />
          {!isDesktop && (
            <Tab to={BINGE_PATH} patterns={[BINGE_PATH]} icon="playback" label={BINGE_COPY.title} />
          )}
          <Tab
            to="/favourites"
            patterns={['/favourites']}
            icon="heart"
            label={COMMON_COPY.favourites}
          />
          {hasMusic && (
            <Tab
              to={MUSIC_PATHS.root}
              patterns={[MUSIC_PATHS.root]}
              icon="music"
              label={APP_SHELL_COPY.music}
            />
          )}
          <AdminOnly>
            <Tab
              to={ADMIN_PATH}
              patterns={[ADMIN_PATH]}
              icon="settings"
              label={ADMIN_COPY.heading}
            />
            <Tab
              to="/streams"
              patterns={['/streams']}
              icon="playback"
              label={APP_SHELL_COPY.streams}
            />
            <Tab
              to="/reports"
              patterns={['/reports']}
              icon="alert"
              label={APP_SHELL_COPY.reports}
            />
          </AdminOnly>
        </>
      )}
      {isDesktop && (
        <>
          <Tab
            to={DESKTOP_PATHS.local}
            patterns={[DESKTOP_PATHS.local]}
            icon="file-play"
            label={APP_SHELL_COPY.thisComputer(computer)}
          />
          <Tab
            to={DESKTOP_PATHS.downloads}
            patterns={[DESKTOP_PATHS.downloads]}
            icon="download"
            label={COMMON_COPY.downloads}
          />
        </>
      )}
      <Tab
        to={PAGE_PATHS.settings}
        patterns={[PAGE_PATHS.settings]}
        icon="settings"
        label={COMMON_COPY.settings}
      />
    </TabStrip>
  )
}
