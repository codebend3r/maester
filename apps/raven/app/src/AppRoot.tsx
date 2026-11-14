import AsyncStorage from '@react-native-async-storage/async-storage'
import { THEME_TONES } from '@raven/core'
import { IS_SIGN_IN_BYPASSED, pinRavenServer, tokenRenewalFor } from '@raven/native/headless'
import { configureStorage, createQueryClient } from '@raven/ui/headless'
import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { hideAsync, preventAutoHideAsync } from 'expo-splash-screen'
import { type ComponentType, Fragment, useEffect, useMemo, useState } from 'react'
import { Appearance, StatusBar, StyleSheet, View } from 'react-native'
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAccountSession } from '@/account/session'
import { DOWNLOAD_DEVICE } from '@/downloads/downloadDevice'
import { clearOnServerSwitch } from '@/queries/serverCache'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { stripEdge } from '@/layouts'
import { STRIP_EDGES } from '@/layouts/musicKit'
import { TouchMenu } from '@/layouts/TouchMenu'
import { TouchTabs, useIsTabBarShown } from '@/layouts/TouchTabs'
import { MusicHost } from '@/music/MusicHost'
import { NowPlayingBar, useIsBarShown } from '@/music/NowPlayingBar'
import { deviceNavKind } from '@/platform/devicePlatform'
import { NAV_KINDS, type NavKind } from '@/platform/platform'
import { APP_ROUTES, APP_SCREENS } from '@/routes'
import { useActiveServer } from '@/stores/activeServer'
import { configureAppPrefs } from '@/stores/appPrefs'
import { configureDownloads, useDownloads } from '@/stores/downloads'
import { configureLibraryViews } from '@/stores/libraryViews'
import { configureSideMenu } from '@/stores/sideMenu'
import { followReduceMotion } from '@/stores/reduceMotion'
import { returnScreen } from '@/stores/screenFocus'
import type { AppTheme } from '@/theme/appTheme'
import { followTheme, useTheme } from '@/theme/useTheme'

/** One cache for the app's life, emptied whenever the active server changes. */
const queryClient = createQueryClient()

/** A splash the system cannot hold or hide leaves the app as it is: the next frame is raven's. */
const SPLASH_IGNORED = (): void => undefined

// The splash stays up until the stores are read, so the theme picked is the first thing drawn.
preventAutoHideAsync().catch(SPLASH_IGNORED)

const useTokenRenewal = tokenRenewalFor({ session: useAccountSession })

const loadStores = async (): Promise<void> => {
  /*
   * A store whose storage cannot be read starts from its defaults rather than holding
   * the app on a blank screen; the next write puts the file right.
   */
  await Promise.allSettled([
    configureStorage({ storage: AsyncStorage }),
    configureLibraryViews({ storage: AsyncStorage }),
    configureAppPrefs({ storage: AsyncStorage }),
    configureSideMenu({ storage: AsyncStorage }),
    configureDownloads({ storage: AsyncStorage, ...DOWNLOAD_DEVICE }),
    useActiveServer.persist.rehydrate(),
    useAccountSession.persist.rehydrate(),
  ])
  pinRavenServer({ servers: useActiveServer })
  // What a relaunch stopped starts again once the servers are known, and the splash waits for none of it.
  useDownloads.getState().resume().catch(SPLASH_IGNORED)
}

type ServerEventsProps = { session: AppQueries }

/** Keeps the cache in step with the active server's event stream, while it is the active one. */
const ServerEvents = ({ session }: ServerEventsProps) => {
  session.useServerEvents()
  return null
}

/**
 * Has the system draw what it draws for raven (alerts, action sheets, keyboards, the TV's own
 * focused fields) light or dark as the theme's ground is.
 */
const wearSystemLook = ({ tone }: AppTheme) => Appearance.setColorScheme(tone)

type DeviceNavProps = { session: AppQueries }

/** A TV moves by its remote's focus through each screen's own menus: nothing above the routes. */
const FocusNav = () => null

/** What each device moves between pages with, above the routes: the iPhone's tabs, the iPad's side menu. */
const DEVICE_NAVS = {
  [NAV_KINDS.tabs]: TouchTabs,
  [NAV_KINDS.drawer]: TouchMenu,
  [NAV_KINDS.focus]: FocusNav,
} as const satisfies Record<NavKind, ComponentType<DeviceNavProps>>

/** The routes, once the stores are read: every route but sign-in needs a server. */
const AppRoutes = () => {
  const session = useAppQueries()
  const isSignedIn = useAccountSession((state) => state.session !== null)
  const ground = useTheme((theme) => theme.palette.ground)
  const tone = useTheme((theme) => theme.tone)
  const insets = useSafeAreaInsets()
  // A strip across the top of a TV takes no inset from the screens, which keep the foot.
  const isBarShown = useIsBarShown() && stripEdge === STRIP_EDGES.bottom
  const hasNav = session !== null && (isSignedIn || IS_SIGN_IN_BYPASSED)
  const isTabBarShown = useIsTabBarShown() && hasNav
  const DeviceNav = DEVICE_NAVS[deviceNavKind()]
  const footless = useMemo(() => ({ ...insets, bottom: 0 }), [insets])
  const screenInsets = isBarShown || isTabBarShown ? footless : insets
  const stripInsets = isTabBarShown ? footless : insets
  const strip = session !== null && (
    <SafeAreaInsetsContext.Provider value={stripInsets}>
      <NowPlayingBar session={session} />
    </SafeAreaInsetsContext.Provider>
  )
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar barStyle={tone === THEME_TONES.light ? 'dark-content' : 'light-content'} />
      {/* One key for both, so a server switch remounts them together and no two siblings share it. */}
      {session !== null && (
        <Fragment key={session.server.id}>
          <ServerEvents session={session} />
          {/* Music plays above the routes, so leaving a screen stops nothing. */}
          <MusicHost session={session} />
        </Fragment>
      )}
      {/* A screen's opening focus comes back once the transition that reveals it has ended:
          on Android TV the transition takes the focus from anything asked for before then. */}
      <View style={styles.frame}>
        {/* A TV's music strip stands across the top, outside every screen, so no page scrolls it away. */}
        {stripEdge === STRIP_EDGES.top && strip}
        {/* The music strip or the tab bar keeps the bottom inset for itself, so the screens above pad none. */}
        <SafeAreaInsetsContext.Provider value={screenInsets}>
          <Stack
            screenListeners={{
              transitionEnd: ({ target, data }) => {
                if (target !== undefined && !data.closing) returnScreen({ screen: target })
              },
            }}
            screenOptions={{ headerShown: false, contentStyle: { backgroundColor: ground } }}
          >
            <Stack.Protected
              guard={session !== null && (isSignedIn || IS_SIGN_IN_BYPASSED)}
              redirectTo={APP_ROUTES.signIn}
            >
              <Stack.Screen name={APP_SCREENS.home} />
              <Stack.Screen name={APP_SCREENS.item} />
              <Stack.Screen name={APP_SCREENS.library} />
              <Stack.Screen name={APP_SCREENS.play} />
              <Stack.Screen name={APP_SCREENS.album} />
              <Stack.Screen name={APP_SCREENS.artist} />
              <Stack.Screen name={APP_SCREENS.saga} />
              <Stack.Screen name={APP_SCREENS.playlist} />
              <Stack.Screen name={APP_SCREENS.nowPlaying} />
              <Stack.Screen name={APP_SCREENS.search} />
              <Stack.Screen name={APP_SCREENS.favourites} />
              <Stack.Screen name={APP_SCREENS.continueWatching} />
              <Stack.Screen name={APP_SCREENS.libraries} />
              <Stack.Screen name={APP_SCREENS.settings} />
              <Stack.Screen name={APP_SCREENS.downloads} />
            </Stack.Protected>
          </Stack>
        </SafeAreaInsetsContext.Provider>
        {/* Under the thumb the strip sits under the screens while a track plays, over the tab bar, which keeps the inset. */}
        {stripEdge === STRIP_EDGES.bottom && strip}
        {/* An iPhone's tab bar along the foot, or an iPad's side menu over the routes and the strip. */}
        {hasNav && <DeviceNav key={session.server.id} session={session} />}
      </View>
    </QueryClientProvider>
  )
}

const styles = StyleSheet.create({ frame: { flex: 1 } })

/**
 * Loads what the app keeps on the device before any route renders, then the routes. Every
 * route but sign-in needs a server, so without one they send the viewer to sign in. Until the
 * prefs are read the splash stays up and the app paints nothing, so the first frame of a theme
 * is the one picked, never the default's on its way to it; the splash goes once that frame is
 * drawn, and after that a theme picked in Settings repaints everything at once.
 */
export const AppRoot = () => {
  const [isLoaded, setLoaded] = useState(false)
  useTokenRenewal()

  useEffect(() => {
    const show = () => setLoaded(true)
    loadStores().then(show, show)
  }, [])
  useEffect(() => clearOnServerSwitch({ client: queryClient, store: useActiveServer }), [])
  useEffect(() => followReduceMotion(), [])
  useEffect(() => (isLoaded ? followTheme({ apply: wearSystemLook }) : undefined), [isLoaded])
  useEffect(() => {
    if (isLoaded) hideAsync().catch(SPLASH_IGNORED)
  }, [isLoaded])

  return isLoaded && <AppRoutes />
}
