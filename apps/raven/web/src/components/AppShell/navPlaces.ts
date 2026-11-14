import { DESKTOP_PATHS } from '@raven/core'
import { APP_SHELL_COPY } from '@/components/AppShell/copy'
import { libraryPages } from '@/components/AppShell/currentPage'
import { APP_PATHS } from '@/lib/appPaths'
import { BINGE_COPY } from '@/lib/binge'
import { COMMON_COPY } from '@/lib/copy'
import { MUSIC_PATHS } from '@/lib/music'
import { COMING_SOON_COPY } from '@/pages/ComingSoonPage/copy'
import { CONTINUE_WATCHING_COPY } from '@/pages/ContinueWatchingPage/copy'
import { NOTIFICATIONS_COPY } from '@/pages/NotificationsPage/copy'
import { PLAY_HISTORY_COPY } from '@/pages/PlayHistoryPage/copy'
import { ADMIN_COPY } from '@/pages/SettingsPage/adminCopy'
import type { TabTarget } from '@/components/TabStrip/TabStrip'

type PlaceAtProps = Omit<TabTarget, 'patterns'>

/** A place marked as current on its own page alone. */
const placeAt = ({ to, icon, label }: PlaceAtProps): TabTarget => ({
  to,
  patterns: [to],
  icon,
  label,
})

/**
 * Every place raven's frame links to, written once for the side menu, the
 * tab bar and its More sheet, each of which picks and orders its own.
 */
export const NAV_PLACES = {
  home: placeAt({ to: APP_PATHS.home, icon: 'home', label: COMMON_COPY.home }),
  continueWatching: placeAt({
    to: APP_PATHS.continueWatching,
    icon: 'continue',
    label: CONTINUE_WATCHING_COPY.title,
  }),
  binge: placeAt({ to: APP_PATHS.binge, icon: 'popcorn', label: BINGE_COPY.title }),
  comingSoon: placeAt({
    to: APP_PATHS.comingSoon,
    icon: 'calendar',
    label: COMING_SOON_COPY.title,
  }),
  favourites: placeAt({ to: APP_PATHS.favourites, icon: 'heart', label: COMMON_COPY.favourites }),
  music: placeAt({ to: MUSIC_PATHS.root, icon: 'music', label: APP_SHELL_COPY.music }),
  libraries: {
    to: APP_PATHS.libraries,
    patterns: [APP_PATHS.libraries, ...libraryPages(':id')],
    icon: 'libraries',
    label: COMMON_COPY.libraries,
  },
  admin: placeAt({ to: APP_PATHS.admin, icon: 'settings', label: ADMIN_COPY.heading }),
  streams: placeAt({ to: APP_PATHS.streams, icon: 'playback', label: APP_SHELL_COPY.streams }),
  reports: placeAt({ to: APP_PATHS.reports, icon: 'alert', label: APP_SHELL_COPY.bugReports }),
  everyonesHistory: placeAt({
    to: APP_PATHS.everyonesHistory,
    icon: 'list',
    label: PLAY_HISTORY_COPY.everyoneTitle,
  }),
  history: placeAt({ to: APP_PATHS.history, icon: 'history', label: PLAY_HISTORY_COPY.title }),
  notifications: placeAt({
    to: APP_PATHS.notifications,
    icon: 'bell',
    label: NOTIFICATIONS_COPY.title,
  }),
  downloads: placeAt({
    to: DESKTOP_PATHS.downloads,
    icon: 'download',
    label: COMMON_COPY.downloads,
  }),
  settings: placeAt({ to: APP_PATHS.settings, icon: 'settings', label: COMMON_COPY.settings }),
  shortcuts: placeAt({
    to: APP_PATHS.shortcuts,
    icon: 'keyboard',
    label: APP_SHELL_COPY.shortcuts,
  }),
  design: placeAt({ to: APP_PATHS.design, icon: 'wand', label: APP_SHELL_COPY.design }),
} as const satisfies Record<string, TabTarget>
