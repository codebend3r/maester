import { Route, Routes } from 'react-router-dom'
import { AUTH_ROUTES, DESKTOP_PATHS, PAGE_PATHS } from '@raven/core'
import { Toaster } from '@raven/ui'
import { AppShell } from '@/components/AppShell/AppShell'
import { AuthGate } from '@/components/AuthGate/AuthGate'
import { DesktopHost } from '@/desktop/DesktopHost'
import { DownloadsPage } from '@/desktop/DownloadsPage/DownloadsPage'
import { LocalPage } from '@/desktop/LocalPage/LocalPage'
import { PlayRoute } from '@/desktop/PlayPage/PlayPage'
import { PinPrompt } from '@/components/PinPrompt/PinPrompt'
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
import { SettingsPage } from '@/pages/SettingsPage/SettingsPage'
import { ShortcutsPage } from '@/pages/ShortcutsPage/ShortcutsPage'
import { ShowPage } from '@/pages/ShowPage/ShowPage'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import { PendingPage } from '@/pages/PendingPage/PendingPage'
import { PersonPage } from '@/pages/PersonPage/PersonPage'
import { AlbumPage } from '@/pages/AlbumPage/AlbumPage'
import { ArtistPage } from '@/pages/ArtistPage/ArtistPage'
import { NowPlayingPage } from '@/pages/NowPlayingPage/NowPlayingPage'
import { NOW_PLAYING_PATH } from '@/lib/music'
import { GetPage } from '@/pages/GetPage/GetPage'
import { CheckEmailPage } from '@/pages/CheckEmailPage/CheckEmailPage'
import { ConfirmPage } from '@/pages/ConfirmPage/ConfirmPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/ResetPasswordPage/ResetPasswordPage'
import { SignInPage } from '@/pages/SignInPage/SignInPage'
import { SignUpPage } from '@/pages/SignUpPage/SignUpPage'
import { WatchPage } from '@/pages/WatchPage/WatchPage'
import { useIsDesktop } from '@/stores/desktop'

/**
 * Every page, behind the sign-in gate but the account pages and Get. Inside
 * Raven the frame adds Downloads and On this Mac, and the app's own
 * part of the page runs over every route.
 */
export const AppRoutes = () => {
  const isDesktop = useIsDesktop()
  return (
    <>
      <Routes>
        <Route element={<AuthGate />}>
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
            <Route path={NOW_PLAYING_PATH} element={<NowPlayingPage />} />
            <Route path="favourites" element={<FavouritesPage />} />
            <Route path="streams" element={<StreamsPage />} />
            <Route path="reports" element={<BugReportsPage />} />
            <Route path="settings" element={<SettingsPage />} />
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
      <PinPrompt />
      {/* Toasts outlast the page that raised them, as Report this error's does the player. */}
      <Toaster />
      {isDesktop && <DesktopHost />}
    </>
  )
}
