import { Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell/AppShell'
import { DesignPage } from '@/pages/DesignPage/DesignPage'
import { FavouritesPage } from '@/pages/FavouritesPage/FavouritesPage'
import { LibrariesPage } from '@/pages/LibrariesPage/LibrariesPage'
import { LibraryPage } from '@/pages/LibraryPage/LibraryPage'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import { WatchPage } from '@/pages/WatchPage/WatchPage'

export const AppRoutes = () => (
  <Routes>
    <Route element={<AppShell />}>
      <Route index element={<LibrariesPage />} />
      <Route path="libraries/:id" element={<LibraryPage />} />
      <Route path="favourites" element={<FavouritesPage />} />
      <Route path="design" element={<DesignPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
    {/* The player takes the whole screen, outside the browsing frame. */}
    <Route path="watch/:id" element={<WatchPage />} />
  </Routes>
)
