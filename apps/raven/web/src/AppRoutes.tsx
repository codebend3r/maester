import { Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell/AppShell'
import { DesignPage } from '@/pages/DesignPage/DesignPage'
import { FavouritesPage } from '@/pages/FavouritesPage/FavouritesPage'
import { HistoryPage } from '@/pages/HistoryPage/HistoryPage'
import { LibrariesPage } from '@/pages/LibrariesPage/LibrariesPage'
import { LibraryPage } from '@/pages/LibraryPage/LibraryPage'
import { EpisodePage } from '@/pages/EpisodePage/EpisodePage'
import { MoviePage } from '@/pages/MoviePage/MoviePage'
import { SeasonPage } from '@/pages/SeasonPage/SeasonPage'
import { ShowPage } from '@/pages/ShowPage/ShowPage'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import { PersonPage } from '@/pages/PersonPage/PersonPage'
import { WatchPage } from '@/pages/WatchPage/WatchPage'

export const AppRoutes = () => (
  <Routes>
    <Route element={<AppShell />}>
      <Route index element={<LibrariesPage />} />
      <Route path="libraries/:id" element={<LibraryPage />} />
      <Route path="libraries/:id/history" element={<HistoryPage />} />
      <Route path="movies/:id" element={<MoviePage />} />
      <Route path="shows/:id" element={<ShowPage />} />
      <Route path="shows/:id/seasons/:number" element={<SeasonPage />} />
      <Route path="episodes/:id" element={<EpisodePage />} />
      <Route path="people/:id" element={<PersonPage />} />
      <Route path="favourites" element={<FavouritesPage />} />
      <Route path="design" element={<DesignPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
    {/* The player takes the whole screen, outside the browsing frame. */}
    <Route path="watch/:id" element={<WatchPage />} />
  </Routes>
)
