import { Route, Routes } from 'react-router-dom'
import { AUTH_ROUTES, DESKTOP_PATHS, PAGE_PATHS } from '@raven/core'
import { Toaster } from '@raven/ui'
import { AppShell } from '@/components/AppShell/AppShell'
import { AuthGate } from '@/components/AuthGate/AuthGate'
import { DesktopHost } from '@/desktop/DesktopHost'
import { DownloadsPage } from '@/desktop/DownloadsPage/DownloadsPage'
import { LocalPage } from '@/desktop/LocalPage/LocalPage'
import { PlayRoute } from '@/desktop/PlayPage/PlayPage'
import { BugReportsPage } from '@/pages/BugReportsPage/BugReportsPage'
import { DesignPage } from '@/pages/DesignPage/DesignPage'
import { FavouritesPage } from '@/pages/FavouritesPage/FavouritesPage'
import { HistoryPage } from '@/pages/HistoryPage/HistoryPage'
import { HomePage } from '@/pages/HomePage/HomePage'
import { LibrariesPage } from '@/pages/LibrariesPage/LibrariesPage'
import { LibraryPage } from '@/pages/LibraryPage/LibraryPage'
import { EpisodePage } from '@/pages/EpisodePage/EpisodePage'
import { MoviePage } from '@/pages/MoviePage/MoviePage'
import { SeasonPage } from '@/pages/SeasonPage/SeasonPage'
import { SagaPage } from '@/pages/SagaPage/SagaPage'
import { StreamsPage } from '@/pages/StreamsPage/StreamsPage'
import { AdminPage, SettingsPage } from '@/pages/SettingsPage/SettingsPage'
import { ADMIN_PATH } from '@/pages/SettingsPage/adminCopy'
import { ShortcutsPage } from '@/pages/ShortcutsPage/ShortcutsPage'
import { ShowPage } from '@/pages/ShowPage/ShowPage'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import { PendingPage } from '@/pages/PendingPage/PendingPage'
import { PersonPage } from '@/pages/PersonPage/PersonPage'
import { AlbumPage } from '@/pages/AlbumPage/AlbumPage'
import { ArtistPage } from '@/pages/ArtistPage/ArtistPage'
import { NowPlayingPage } from '@/pages/NowPlayingPage/NowPlayingPage'
import { PlaylistPage } from '@/pages/PlaylistPage/PlaylistPage'
import { MUSIC_PATHS, NOW_PLAYING_PATH, PLAYLIST_ROUTE } from '@/lib/music'
import { MusicShell } from '@/components/MusicShell/MusicShell'
import { PlayerLayer } from '@/components/PlayerLayer/PlayerLayer'
import { MixPage } from '@/pages/MixPage/MixPage'
import { MusicHomePage } from '@/pages/MusicHomePage/MusicHomePage'
import { MUSIC_LIBRARY_SECTIONS, MusicLibraryPage } from '@/pages/MusicLibraryPage/MusicLibraryPage'
import { MusicSearchPage } from '@/pages/MusicSearchPage/MusicSearchPage'
import { GetPage } from '@/pages/GetPage/GetPage'
import { CheckEmailPage } from '@/pages/CheckEmailPage/CheckEmailPage'
import { ConfirmPage } from '@/pages/ConfirmPage/ConfirmPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/ResetPasswordPage/ResetPasswordPage'
import { SignInPage } from '@/pages/SignInPage/SignInPage'
import { SignUpPage } from '@/pages/SignUpPage/SignUpPage'
import { WatchPage } from '@/pages/WatchPage/WatchPage'
import { useIsDesktop } from '@/stores/desktop'
import { BingePage } from '@/pages/BingePage/BingePage'
import { BINGE_PATH } from '@/lib/binge'

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
      <Routes>
        <Route element={<AuthGate />}>
          <Route element={<PlayerLayer />}>
            <Route element={<AppShell />}>
              <Route index element={<HomePage />} />
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
              {!isDesktop && <Route path={BINGE_PATH} element={<BingePage />} />}
              <Route path="favourites" element={<FavouritesPage />} />
              <Route path="streams" element={<StreamsPage />} />
              <Route path="reports" element={<BugReportsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path={ADMIN_PATH} element={<AdminPage />} />
              <Route path={PAGE_PATHS.shortcuts} element={<ShortcutsPage />} />
              <Route path="design" element={<DesignPage />} />
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
      {/* Over any page, the player too: whatever sits in a locked library asks for the PIN. */}
      {/* Toasts outlast the page that raised them, as Report this error's does the player. */}
      <Toaster />
      {isDesktop && <DesktopHost />}
    </>
  )
}
