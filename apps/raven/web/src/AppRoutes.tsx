import { Suspense, useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import {
  AUTH_ROUTES,
  DESKTOP_PATHS,
  type DownloadView,
  PAGE_PATHS,
  UPCOMING_SHELVES,
} from '@raven/core'
import { Toaster } from '@raven/ui'
import { AuthGate } from '@/components/AuthGate/AuthGate'
import { RavenLoader } from '@/components/RavenLoader/RavenLoader'
import { HomeSkeleton } from '@/pages/HomePage/HomeSkeleton'
import {
  COMING_SOON_PATH,
  COMING_SOON_TITLE_ROUTE,
  comingSoonShelfPath,
} from '@/pages/ComingSoonPage/copy'
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
import type { BrowserDownloads } from '@/browserDownloads/engine'
import { keepOfflinePages } from '@/browserDownloads/keepOffline'
import { BROWSER_PLAY_PATH } from '@/browserDownloads/paths'
import { useBrowserDownloads } from '@/stores/browserDownloads'
import { useIsDesktop } from '@/stores/desktop'
import { useDownloadsHostOrNone } from '@/stores/downloadsHost'
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
const loadAppShell = () =>
  import('@/components/AppShell/AppShell').then((module) => module.AppShell)
const AppShell = lazyPage(loadAppShell)
const MusicShell = lazyPage(() =>
  import('@/components/MusicShell/MusicShell').then((module) => module.MusicShell),
)
const loadPlayerLayer = () =>
  import('@/components/PlayerLayer/PlayerLayer').then((module) => module.PlayerLayer)
const PlayerLayer = lazyPage(loadPlayerLayer)
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
const loadWatchPage = () => import('@/pages/WatchPage/WatchPage').then((module) => module.WatchPage)
const WatchPage = lazyPage(loadWatchPage)
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
const UpcomingTitlePage = lazyPage(() =>
  import('@/pages/ComingSoonPage/UpcomingTitlePage').then((module) => module.UpcomingTitlePage),
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
const loadSettingsPage = () =>
  import('@/pages/SettingsPage/SettingsPage').then((page) => page.SettingsPage)
const SettingsPage = lazyPage(loadSettingsPage)
const AdminPage = lazyPage(() =>
  import('@/pages/SettingsPage/SettingsPage').then((page) => page.AdminPage),
)
const ShortcutsPage = lazyPage(() =>
  import('@/pages/ShortcutsPage/ShortcutsPage').then((page) => page.ShortcutsPage),
)
const DesignPage = lazyPage(() =>
  import('@/pages/DesignPage/DesignPage').then((page) => page.DesignPage),
)
const loadDownloadsPage = () =>
  import('@/desktop/DownloadsPage/DownloadsPage').then((page) => page.DownloadsPage)
const DownloadsPage = lazyPage(loadDownloadsPage)
const LocalPage = lazyPage(() =>
  import('@/desktop/LocalPage/LocalPage').then((page) => page.LocalPage),
)
const PlayRoute = lazyPage(() =>
  import('@/desktop/PlayPage/PlayPage').then((page) => page.PlayRoute),
)
const loadBrowserDownloadsHost = () =>
  import('@/browserDownloads/BrowserDownloadsHost').then((module) => module.BrowserDownloadsHost)
const BrowserDownloadsHost = lazyPage(loadBrowserDownloadsHost)
const loadBrowserPlayRoute = () =>
  import('@/browserDownloads/BrowserPlayPage/BrowserPlayPage').then((page) => page.BrowserPlayRoute)
const BrowserPlayRoute = lazyPage(loadBrowserPlayRoute)

/*
 * The chunks a browser that keeps downloads shows with no server: the frame, Downloads, a
 * download's player, the watch page that falls back to it, and Settings. The installed app has
 * its service worker keep them, though no visit may have opened them yet.
 */
const OFFLINE_PAGES = [
  loadAppShell,
  loadPlayerLayer,
  loadDownloadsPage,
  loadBrowserDownloadsHost,
  loadBrowserPlayRoute,
  loadWatchPage,
  loadSettingsPage,
] as const

/*
 * Has the service worker keep the offline pages, from the first download on. A browser with
 * nothing downloaded has no page to open with no server, and fetching the player's and the
 * watch page's chunks on every visit, the sign-in page's included, cost that visit its speed.
 */
const useKeepOfflinePages = (engine: BrowserDownloads | null): void => {
  useEffect(() => {
    if (engine === null) return undefined
    const kept = { isAsked: false }
    const keep = (downloads: readonly DownloadView[]): void => {
      if (kept.isAsked || downloads.length === 0) return
      kept.isAsked = true
      keepOfflinePages({ target: window, pages: OFFLINE_PAGES }).catch(() => undefined)
    }
    keep(engine.list())
    return engine.subscribe(({ downloads }) => keep(downloads))
  }, [engine])
}

/**
 * Every page, behind the sign-in gate but the account pages and Get. The
 * browsing pages sit in one of two shells over the one player: raven's own,
 * and the music mode's under `/music`, which shows the same album, artist,
 * playlist and Now Playing pages. Where the page keeps downloads, inside
 * Raven or in a browser that can, the frame adds Downloads and the host's
 * own part of the page runs over every route; Raven adds On this Mac and
 * its player of a file, a browser its player of a download.
 */
export const AppRoutes = () => {
  const isDesktop = useIsDesktop()
  const host = useDownloadsHostOrNone()
  const engine = useBrowserDownloads((state) => state.engine)

  useKeepOfflinePages(engine)
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
                <Route path={COMING_SOON_TITLE_ROUTE} element={<UpcomingTitlePage />} />
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
                {host !== null && (
                  <Route path={DESKTOP_PATHS.downloads} element={<DownloadsPage />} />
                )}
                {isDesktop && <Route path={DESKTOP_PATHS.local} element={<LocalPage />} />}
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
                {!!host?.canKeepMusic && (
                  <Route path={MUSIC_PATHS.downloads} element={<DownloadsPage />} />
                )}
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Route>
            {/* The player takes the whole screen, outside the browsing frame, as a file Raven plays does. */}
            <Route path={`${PAGE_PATHS.watch}/:id`} element={<WatchPage />} />
            {isDesktop && <Route path={DESKTOP_PATHS.play} element={<PlayRoute />} />}
            {engine !== null && <Route path={BROWSER_PLAY_PATH} element={<BrowserPlayRoute />} />}
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
      {engine !== null && (
        <Suspense>
          <BrowserDownloadsHost engine={engine} />
        </Suspense>
      )}
    </>
  )
}
