import { Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AUTH_ROUTES, DESKTOP_PATHS, PAGE_PATHS, UPCOMING_SHELVES } from '@raven/core'
import { Toaster } from '@raven/ui'
import { AuthGate } from '@/components/AuthGate/AuthGate'
import { RavenLoader } from '@/components/RavenLoader/RavenLoader'
import { HomeSkeleton } from '@/pages/HomePage/HomeSkeleton'
import { COMING_SOON_PATH, comingSoonShelfPath } from '@/pages/ComingSoonPage/copy'
import { DESIGN_PATH } from '@/pages/DesignPage/copy'
import { ADMIN_PATH } from '@/pages/SettingsPage/adminCopy'
import { PendingPage } from '@/pages/PendingPage/PendingPage'
import { PLAY_HISTORY_ROUTES } from '@/lib/playHistory'
import { lazyPage } from '@/lib/lazyPage'
import { MUSIC_PATHS, NOW_PLAYING_PATH, PLAYLIST_ROUTE } from '@/lib/music'
import { MUSIC_LIBRARY_SECTIONS } from '@/pages/MusicLibraryPage/sections'
import { CheckEmailPage } from '@/pages/CheckEmailPage/CheckEmailPage'
import { ConfirmPage } from '@/pages/ConfirmPage/ConfirmPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/ResetPasswordPage/ResetPasswordPage'
import { SignInPage } from '@/pages/SignInPage/SignInPage'
import { SignUpPage } from '@/pages/SignUpPage/SignUpPage'
import { useIsDesktop } from '@/stores/desktop'
import { BINGE_PATH } from '@/lib/binge'
import { CONTINUE_WATCHING_PATH } from '@/lib/homeContinue'
import { NOTIFICATIONS_PATH } from '@/lib/notifications'
import { useLogToasts } from '@/lib/useLogToasts'

/** Logs every toast raised here on the server, for the account's Notifications page. */
const LogToasts = () => {
  useLogToasts()
  return null
}

/*
 * Only the account pages load with the app: a first visit lands on the sign-in page, and every
 * page behind the gate, with the shells and the player around them, loads as a chunk of its own
 * the first time a route asks for it, so a visitor who is signed out downloads none of it.
 */
const AppShell = lazyPage(() =>
  import('@/components/AppShell/AppShell').then((module) => module.AppShell),
)
const MusicShell = lazyPage(() =>
  import('@/components/MusicShell/MusicShell').then((module) => module.MusicShell),
)
const PlayerLayer = lazyPage(() =>
  import('@/components/PlayerLayer/PlayerLayer').then((module) => module.PlayerLayer),
)
const DesktopHost = lazyPage(() =>
  import('@/desktop/DesktopHost').then((module) => module.DesktopHost),
)
const FavouritesPage = lazyPage(() =>
  import('@/pages/FavouritesPage/FavouritesPage').then((module) => module.FavouritesPage),
)
const HistoryPage = lazyPage(() =>
  import('@/pages/HistoryPage/HistoryPage').then((module) => module.HistoryPage),
)
const NotificationsPage = lazyPage(() =>
  import('@/pages/NotificationsPage/NotificationsPage').then((module) => module.NotificationsPage),
)
const HomePage = lazyPage(() =>
  import('@/pages/HomePage/HomePage').then((module) => module.HomePage),
)
const LibrariesPage = lazyPage(() =>
  import('@/pages/LibrariesPage/LibrariesPage').then((module) => module.LibrariesPage),
)
const LibraryPage = lazyPage(() =>
  import('@/pages/LibraryPage/LibraryPage').then((module) => module.LibraryPage),
)
const EpisodePage = lazyPage(() =>
  import('@/pages/EpisodePage/EpisodePage').then((module) => module.EpisodePage),
)
const MoviePage = lazyPage(() =>
  import('@/pages/MoviePage/MoviePage').then((module) => module.MoviePage),
)
const SeasonPage = lazyPage(() =>
  import('@/pages/SeasonPage/SeasonPage').then((module) => module.SeasonPage),
)
const SagaPage = lazyPage(() =>
  import('@/pages/SagaPage/SagaPage').then((module) => module.SagaPage),
)
const ShowPage = lazyPage(() =>
  import('@/pages/ShowPage/ShowPage').then((module) => module.ShowPage),
)
const NotFoundPage = lazyPage(() =>
  import('@/pages/NotFoundPage/NotFoundPage').then((module) => module.NotFoundPage),
)
const PersonPage = lazyPage(() =>
  import('@/pages/PersonPage/PersonPage').then((module) => module.PersonPage),
)
const GetPage = lazyPage(() => import('@/pages/GetPage/GetPage').then((module) => module.GetPage))
const WatchPage = lazyPage(() =>
  import('@/pages/WatchPage/WatchPage').then((module) => module.WatchPage),
)
const BingePage = lazyPage(() =>
  import('@/pages/BingePage/BingePage').then((module) => module.BingePage),
)
const ContinueWatchingPage = lazyPage(() =>
  import('@/pages/ContinueWatchingPage/ContinueWatchingPage').then(
    (module) => module.ContinueWatchingPage,
  ),
)
const ComingSoonPage = lazyPage(() =>
  import('@/pages/ComingSoonPage/ComingSoonPage').then((module) => module.ComingSoonPage),
)
const UpcomingShelfPage = lazyPage(() =>
  import('@/pages/ComingSoonPage/UpcomingShelfPage').then((module) => module.UpcomingShelfPage),
)
const AlbumPage = lazyPage(() =>
  import('@/pages/AlbumPage/AlbumPage').then((page) => page.AlbumPage),
)
const ArtistPage = lazyPage(() =>
  import('@/pages/ArtistPage/ArtistPage').then((page) => page.ArtistPage),
)
const PlaylistPage = lazyPage(() =>
  import('@/pages/PlaylistPage/PlaylistPage').then((page) => page.PlaylistPage),
)
const NowPlayingPage = lazyPage(() =>
  import('@/pages/NowPlayingPage/NowPlayingPage').then((page) => page.NowPlayingPage),
)
const MixPage = lazyPage(() => import('@/pages/MixPage/MixPage').then((page) => page.MixPage))
const MusicHomePage = lazyPage(() =>
  import('@/pages/MusicHomePage/MusicHomePage').then((page) => page.MusicHomePage),
)
const MusicLibraryPage = lazyPage(() =>
  import('@/pages/MusicLibraryPage/MusicLibraryPage').then((page) => page.MusicLibraryPage),
)
const MusicSearchPage = lazyPage(() =>
  import('@/pages/MusicSearchPage/MusicSearchPage').then((page) => page.MusicSearchPage),
)
const PlayHistoryPage = lazyPage(() =>
  import('@/pages/PlayHistoryPage/PlayHistoryPage').then((page) => page.PlayHistoryPage),
)
const EveryonesHistoryPage = lazyPage(() =>
  import('@/pages/PlayHistoryPage/PlayHistoryPage').then((page) => page.EveryonesHistoryPage),
)
const StreamsPage = lazyPage(() =>
  import('@/pages/StreamsPage/StreamsPage').then((page) => page.StreamsPage),
)
const BugReportsPage = lazyPage(() =>
  import('@/pages/BugReportsPage/BugReportsPage').then((page) => page.BugReportsPage),
)
const SettingsPage = lazyPage(() =>
  import('@/pages/SettingsPage/SettingsPage').then((page) => page.SettingsPage),
)
const AdminPage = lazyPage(() =>
  import('@/pages/SettingsPage/SettingsPage').then((page) => page.AdminPage),
)
const ShortcutsPage = lazyPage(() =>
  import('@/pages/ShortcutsPage/ShortcutsPage').then((page) => page.ShortcutsPage),
)
const DesignPage = lazyPage(() =>
  import('@/pages/DesignPage/DesignPage').then((page) => page.DesignPage),
)
const DownloadsPage = lazyPage(() =>
  import('@/desktop/DownloadsPage/DownloadsPage').then((page) => page.DownloadsPage),
)
const LocalPage = lazyPage(() =>
  import('@/desktop/LocalPage/LocalPage').then((page) => page.LocalPage),
)
const PlayRoute = lazyPage(() =>
  import('@/desktop/PlayPage/PlayPage').then((page) => page.PlayRoute),
)

/**
 * Every page, behind the sign-in gate but the account pages and Get. The
 * browsing pages sit in one of two shells over the one player: raven's own,
 * and the music mode's under `/music`, which shows the same album, artist,
 * playlist and Now Playing pages. Inside Raven the frame adds Downloads and
 * On this Mac, and the app's own part of the page runs over every route.
 */
export const AppRoutes = () => {
  const isDesktop = useIsDesktop()
  return (
    <>
      {/* While a page's chunk loads, the loader the gate shows while the account is read. */}
      <Suspense fallback={<RavenLoader isFullscreen shouldShowLabel={false} />}>
        <Routes>
          <Route element={<AuthGate />}>
            <Route element={<PlayerLayer />}>
              <Route element={<AppShell />}>
                <Route
                  index
                  element={
                    <Suspense fallback={<HomeSkeleton />}>
                      <HomePage />
                    </Suspense>
                  }
                />
                <Route path="libraries" element={<LibrariesPage />} />
                <Route path="libraries/:id" element={<LibraryPage />} />
                <Route path="libraries/:id/history" element={<HistoryPage />} />
                <Route path="libraries/:id/:section" element={<LibraryPage />} />
                <Route path="libraries/:id/sagas/:sagaId" element={<SagaPage />} />
                <Route path="movies/:id" element={<MoviePage />} />
                <Route path="shows/:id" element={<ShowPage />} />
                <Route path="shows/:id/seasons/:number" element={<SeasonPage />} />
                <Route path="episodes/:id" element={<EpisodePage />} />
                <Route path="people/:id" element={<PersonPage />} />
                <Route path="albums/:id" element={<AlbumPage />} />
                <Route path="artists/:id" element={<ArtistPage />} />
                <Route path={PLAYLIST_ROUTE} element={<PlaylistPage />} />
                <Route path={NOW_PLAYING_PATH} element={<NowPlayingPage />} />
                <Route path={BINGE_PATH} element={<BingePage />} />
                <Route path={CONTINUE_WATCHING_PATH} element={<ContinueWatchingPage />} />
                <Route path={COMING_SOON_PATH} element={<ComingSoonPage />} />
                {Object.values(UPCOMING_SHELVES).map((shelf) => (
                  <Route
                    key={shelf}
                    path={comingSoonShelfPath(shelf)}
                    element={<UpcomingShelfPage key={shelf} shelf={shelf} />}
                  />
                ))}
                <Route path="favourites" element={<FavouritesPage />} />
                <Route path={PLAY_HISTORY_ROUTES.own} element={<PlayHistoryPage />} />
                <Route path={PLAY_HISTORY_ROUTES.everyone} element={<EveryonesHistoryPage />} />
                <Route path="streams" element={<StreamsPage />} />
                <Route path="reports" element={<BugReportsPage />} />
                <Route path={NOTIFICATIONS_PATH} element={<NotificationsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path={ADMIN_PATH} element={<AdminPage />} />
                <Route path={PAGE_PATHS.shortcuts} element={<ShortcutsPage />} />
                <Route path={DESIGN_PATH} element={<DesignPage />} />
                {isDesktop && (
                  <>
                    <Route path={DESKTOP_PATHS.downloads} element={<DownloadsPage />} />
                    <Route path={DESKTOP_PATHS.local} element={<LocalPage />} />
                  </>
                )}
                <Route path="*" element={<NotFoundPage />} />
              </Route>
              <Route path={MUSIC_PATHS.root} element={<MusicShell />}>
                <Route index element={<MusicHomePage />} />
                <Route
                  path={MUSIC_PATHS.albums}
                  element={<MusicLibraryPage section={MUSIC_LIBRARY_SECTIONS.albums} />}
                />
                <Route
                  path={MUSIC_PATHS.artists}
                  element={<MusicLibraryPage section={MUSIC_LIBRARY_SECTIONS.artists} />}
                />
                <Route
                  path={MUSIC_PATHS.noArtwork}
                  element={<MusicLibraryPage section={MUSIC_LIBRARY_SECTIONS.noArtwork} />}
                />
                <Route
                  path={MUSIC_PATHS.songs}
                  element={<MusicLibraryPage section={MUSIC_LIBRARY_SECTIONS.songs} />}
                />
                <Route
                  path={MUSIC_PATHS.playlists}
                  element={<MusicLibraryPage section={MUSIC_LIBRARY_SECTIONS.playlists} />}
                />
                <Route path={MUSIC_PATHS.album} element={<AlbumPage />} />
                <Route path={MUSIC_PATHS.artist} element={<ArtistPage />} />
                <Route path={MUSIC_PATHS.playlist} element={<PlaylistPage />} />
                <Route path={MUSIC_PATHS.mix} element={<MixPage />} />
                <Route path={MUSIC_PATHS.nowPlaying} element={<NowPlayingPage />} />
                <Route path={MUSIC_PATHS.search} element={<MusicSearchPage />} />
                {isDesktop && <Route path={MUSIC_PATHS.downloads} element={<DownloadsPage />} />}
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Route>
            {/* The player takes the whole screen, outside the browsing frame, as a file Raven plays does. */}
            <Route path={`${PAGE_PATHS.watch}/:id`} element={<WatchPage />} />
            {isDesktop && <Route path={DESKTOP_PATHS.play} element={<PlayRoute />} />}
          </Route>
          {/* So do the account pages, which sit outside the gate they serve, and the page to get raven from. */}
          <Route path={AUTH_ROUTES.signIn} element={<SignInPage />} />
          <Route path={AUTH_ROUTES.signUp} element={<SignUpPage />} />
          <Route path={AUTH_ROUTES.checkEmail} element={<CheckEmailPage />} />
          <Route path={AUTH_ROUTES.confirm} element={<ConfirmPage />} />
          <Route path={AUTH_ROUTES.forgot} element={<ForgotPasswordPage />} />
          <Route path={AUTH_ROUTES.reset} element={<ResetPasswordPage />} />
          <Route path={AUTH_ROUTES.pending} element={<PendingPage />} />
          <Route path="get" element={<GetPage />} />
        </Routes>
      </Suspense>
      {/* Over any page, the player too: whatever sits in a locked library asks for the PIN. */}
      {/* Toasts outlast the page that raised them, as Report this error's does the player. */}
      <Toaster />
      <LogToasts />
      {isDesktop && (
        <Suspense>
          <DesktopHost />
        </Suspense>
      )}
    </>
  )
}
