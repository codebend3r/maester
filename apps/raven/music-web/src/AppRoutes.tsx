import { lazyPage } from '@raven/ui/headless'
import { type ComponentType, Suspense } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { ACCESS_KINDS, type AccessKind, useAccess } from '@/lib/access'
import { WREN_ROUTES } from '@/routes'
import { SignIn } from '@/screens/SignIn/SignIn'
import { Loading } from '@/shell/Loading/Loading'
import { Shell } from '@/shell/Shell'

/** What react-router matches when no page does. */
const NOT_FOUND_ROUTE = '*'

/*
 * Sign-in loads with the app, since a first visit lands on it; every page behind it loads as a
 * chunk of its own the first time a route asks for it.
 */
const Home = lazyPage(() => import('@/screens/Home/Home').then((module) => module.Home))
const Library = lazyPage(() => import('@/screens/Library/Library').then((module) => module.Library))
const Search = lazyPage(() => import('@/screens/Search/Search').then((module) => module.Search))
const Settings = lazyPage(() =>
  import('@/screens/Settings/Settings').then((module) => module.Settings),
)
const Album = lazyPage(() => import('@/screens/Album/Album').then((module) => module.Album))
const Artist = lazyPage(() => import('@/screens/Artist/Artist').then((module) => module.Artist))
const Playlist = lazyPage(() =>
  import('@/screens/Playlist/Playlist').then((module) => module.Playlist),
)
const Collection = lazyPage(() =>
  import('@/screens/Collection/Collection').then((module) => module.Collection),
)
const NowPlaying = lazyPage(() =>
  import('@/screens/NowPlaying/NowPlaying').then((module) => module.NowPlaying),
)

/** The page asked for, once its code has come. */
function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Outlet />
    </Suspense>
  )
}

function ToSignIn() {
  return <Navigate replace to={WREN_ROUTES.signIn} />
}

function ToHome() {
  return <Navigate replace to={WREN_ROUTES.home} />
}

/** What a page behind sign-in shows, by where the listener stands. */
const GUARDED_VIEWS = {
  [ACCESS_KINDS.loading]: Loading,
  [ACCESS_KINDS.open]: Page,
  [ACCESS_KINDS.signedOut]: ToSignIn,
} as const satisfies Record<AccessKind, ComponentType>

/** Every page but sign-in needs the listener let in; signed out, they land on `/sign-in`. */
function Guarded() {
  const View = GUARDED_VIEWS[useAccess()]
  return <View />
}

/** What `/sign-in` shows: its form to a listener signed out, Home to one already let in. */
const SIGN_IN_VIEWS = {
  [ACCESS_KINDS.loading]: Loading,
  [ACCESS_KINDS.open]: ToHome,
  [ACCESS_KINDS.signedOut]: SignIn,
} as const satisfies Record<AccessKind, ComponentType>

function SignInRoute() {
  const View = SIGN_IN_VIEWS[useAccess()]
  return <View />
}

/**
 * Wren's pages, the same as the files under the phone and tablet apps' `app/` (`parity.test.ts`
 * checks the two sets match), inside the shell that frames them all.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route element={<Guarded />}>
          <Route element={<Home />} path={WREN_ROUTES.home} />
          <Route element={<Library />} path={WREN_ROUTES.library} />
          <Route element={<Search />} path={WREN_ROUTES.search} />
          <Route element={<Settings />} path={WREN_ROUTES.settings} />
          <Route element={<Album />} path={WREN_ROUTES.album} />
          <Route element={<Artist />} path={WREN_ROUTES.artist} />
          <Route element={<Playlist />} path={WREN_ROUTES.playlist} />
          <Route element={<Collection />} path={WREN_ROUTES.collection} />
          <Route element={<NowPlaying />} path={WREN_ROUTES.nowPlaying} />
        </Route>
        <Route element={<SignInRoute />} path={WREN_ROUTES.signIn} />
        <Route element={<ToHome />} path={NOT_FOUND_ROUTE} />
      </Route>
    </Routes>
  )
}
