import type { Account, AdminLock, Library } from '@raven/core'
import { Route, Routes, useLocation, useParams } from 'react-router-dom'
import { LibraryPage } from '@/pages/LibraryPage/LibraryPage'
import { renderWithProviders } from '@/test/render'

/** Stands in for the player: says which video the page went to. */
const Watching = () => <p>Watching {useParams().id}</p>

/** Stands in for an item's page, where a test puts the page behind the library. */
const Item = () => <p>Item {useParams().id}</p>

/** Prints where the page is, path and query string, so a test can read where it went and what it wrote there. */
const Address = () => {
  const { pathname, search } = useLocation()
  return <p data-testid="address">{`${pathname}${search}`}</p>
}

/**
 * Opens a library's page at `route`, routed as the app routes it: All at
 * the library's own address, each other tab beneath it, and the player.
 * The library and its listings come from whatever the test spies serve;
 * `behind` is the pages before it in history, `libraries` the list the side
 * menu has read, if any, and `adminLock` the admin lock, off unless given, and `account` an account signed in
 * on a server with accounts instead.
 */
export const renderLibraryPage = ({
  route = '/libraries/2',
  behind,
  libraries = null,
  adminLock,
  account,
}: {
  route?: string
  behind?: string[]
  libraries?: Library[] | null
  adminLock?: AdminLock
  account?: Account
} = {}) =>
  renderWithProviders({
    ui: (
      <>
        <Routes>
          <Route path="libraries/:id" element={<LibraryPage />} />
          <Route path="libraries/:id/:section" element={<LibraryPage />} />
          <Route path="watch/:id" element={<Watching />} />
          <Route path="movies/:id" element={<Item />} />
        </Routes>
        <Address />
      </>
    ),
    route,
    behind,
    libraries,
    adminLock,
    account,
  })
