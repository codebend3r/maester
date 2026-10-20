import { Route, Routes } from 'react-router-dom'
import { AUTH_ROUTES } from '@raven/core'
import { Toaster } from '@raven/ui'
import { AppShell } from '@/components/AppShell/AppShell'
import { AuthGate } from '@/components/AuthGate/AuthGate'
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
import { ShowPage } from '@/pages/ShowPage/ShowPage'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import { PendingPage } from '@/pages/PendingPage/PendingPage'
import { PersonPage } from '@/pages/PersonPage/PersonPage'
import { GetPage } from '@/pages/GetPage/GetPage'
import { CheckEmailPage } from '@/pages/CheckEmailPage/CheckEmailPage'
import { ConfirmPage } from '@/pages/ConfirmPage/ConfirmPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/ResetPasswordPage/ResetPasswordPage'
import { SignInPage } from '@/pages/SignInPage/SignInPage'
import { SignUpPage } from '@/pages/SignUpPage/SignUpPage'
import { WatchPage } from '@/pages/WatchPage/WatchPage'

export const AppRoutes = () => (
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
          <Route path="favourites" element={<FavouritesPage />} />
          <Route path="streams" element={<StreamsPage />} />
          <Route path="reports" element={<BugReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="design" element={<DesignPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        {/* The player takes the whole screen, outside the browsing frame. */}
        <Route path="watch/:id" element={<WatchPage />} />
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
  </>
)
