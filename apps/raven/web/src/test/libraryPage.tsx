import { Route, Routes, useLocation, useParams } from 'react-router-dom'
import { LibraryPage } from '@/pages/LibraryPage/LibraryPage'
import { renderWithProviders } from '@/test/render'

/** Stands in for the player: says which video the page went to. */
const Watching = () => <p>Watching {useParams().id}</p>

/** Prints where the page is, path and query string, so a test can read where it went and what it wrote there. */
const Address = () => {
  const { pathname, search } = useLocation()
  return <p data-testid="address">{`${pathname}${search}`}</p>
}

/**
 * Opens a library's page at `route`, routed as the app routes it: All at
 * the library's own address, each other tab beneath it, and the player.
 * The library and its listings come from whatever the test spies serve.
 */
export const renderLibraryPage = ({ route = '/libraries/2' }: { route?: string } = {}) =>
  renderWithProviders(
    <>
      <Routes>
        <Route path="libraries/:id" element={<LibraryPage />} />
        <Route path="libraries/:id/:section" element={<LibraryPage />} />
        <Route path="watch/:id" element={<Watching />} />
      </Routes>
      <Address />
    </>,
    { route },
  )
