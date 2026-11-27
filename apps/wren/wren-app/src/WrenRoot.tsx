import AsyncStorage from '@react-native-async-storage/async-storage'
import { followAccountServers } from '@raven/native'
import {
  IGNORED,
  IS_SIGN_IN_BYPASSED,
  accountIdOf,
  tokenRenewalFor,
  useStoresLoaded,
} from '@raven/native/headless'
import { COLOR_SCHEMES, type ColorScheme } from '@raven/wren'
import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { hideAsync, preventAutoHideAsync } from 'expo-splash-screen'
import { type ReactNode, useEffect } from 'react'
import { StatusBar, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useReducedMotion } from 'react-native-reanimated'

import { BAR_PLACES, NowPlayingBar } from '@/components/NowPlayingBar'
import { downloadSources } from '@/downloads/downloadDevice'
import { configureDownloads } from '@/downloads/downloadStore'
import { deviceDisk } from '@/downloads/downloader'
import { WrenAudioHost } from '@/music/WrenAudioHost'
import { forgetWrenAccount, keepDownloadsFor, queryClient } from '@/queryClient'
import {
  useWrenAccount,
  accountServers,
  useActiveServer,
  configureRecentSearches,
  configureSongProgress,
  useWren,
} from '@raven/wren-native'
import { WREN_ROUTES, WREN_SCREENS, configureLibraryChoice } from '@raven/wren-native/headless'
import { configureWrenPrefs, useWrenPrefs } from '@/stores/wrenPrefs'
import { CHROMES } from '@/shell/chrome'
import { TabletPlayerBar } from '@/shell/TabletPlayerBar'
import { TabletSidebar } from '@/shell/TabletSidebar'
import { useChrome } from '@/shell/useShell'
import { type WrenTheme, themedStyles, useFormFactor, useWrenTheme } from '@/theme/wrenTheme'
import { FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { ToastHost } from '@/ui/Toast'

// The splash stays up until the stores are read, so the first screen drawn is the right one; one the system cannot hold leaves Wren as it is.
preventAutoHideAsync().catch(IGNORED)

/** How the system draws the clock and battery over each scheme's ground. */
const BAR_STYLES = {
  [COLOR_SCHEMES.dark]: 'light-content',
  [COLOR_SCHEMES.light]: 'dark-content',
} as const satisfies Record<ColorScheme, 'light-content' | 'dark-content'>

/*
 * Now Playing covers the whole screen and rises from the bottom, or simply appears when the
 * system asks for less motion.
 */
const NOW_PLAYING_OPTIONS = {
  moving: { presentation: 'fullScreenModal', animation: 'slide_from_bottom' },
  still: { presentation: 'fullScreenModal', animation: 'none' },
} as const

const useTokenRenewal = tokenRenewalFor({ session: useWrenAccount })

const loadStores = async (): Promise<void> => {
  // The shared listings read the music library picked in this app's own prefs.
  configureLibraryChoice({ prefs: useWrenPrefs })
  /*
   * A store whose keychain or AsyncStorage cannot be read starts empty rather than holding
   * Wren on the splash.
   */
  await Promise.allSettled([
    useActiveServer.persist.rehydrate(),
    useWrenAccount.persist.rehydrate(),
    configureWrenPrefs({ storage: AsyncStorage }),
    configureRecentSearches({ storage: AsyncStorage }),
    configureSongProgress({ storage: AsyncStorage }),
    configureDownloads({ storage: AsyncStorage, disk: deviceDisk, ...downloadSources }),
  ])
  // The account read back may not be the downloads' owner, whatever order the stores loaded in.
  await keepDownloadsFor({ accountId: accountIdOf(useWrenAccount.getState()) })
}

/**
 * Reads what Wren keeps on the device before any route renders, then the routes. The tabs need
 * a signed-in account on raven, so without one they send the listener to sign in. The account's
 * access token is renewed a minute before it ends, so a call never meets an expired one, and
 * the cache is emptied when the account changes. Music plays from here, above every route, and
 * the now-playing bar sits at the foot of the pages the stack opens.
 */
export function WrenRoot() {
  const styles = useStyles()
  const { scheme, colors } = useWrenTheme()
  const isLoaded = useStoresLoaded({ load: loadStores })
  const session = useWren()
  const isSignedIn = useWrenAccount((state) => state.session !== null)
  const nowPlayingOptions = useReducedMotion()
    ? NOW_PLAYING_OPTIONS.still
    : NOW_PLAYING_OPTIONS.moving

  useTokenRenewal()
  useEffect(forgetWrenAccount, [])
  useEffect(() => {
    if (isLoaded) hideAsync().catch(IGNORED)
  }, [isLoaded])
  useEffect(
    () =>
      isLoaded
        ? followAccountServers({ sync: accountServers.sync, session: useWrenAccount })
        : undefined,
    [isLoaded],
  )

  return (
    isLoaded && (
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={styles.root}>
          <StatusBar barStyle={BAR_STYLES[scheme]} />
          {session !== null && <WrenAudioHost key={session.server.id} session={session} />}
          <WrenShell>
            <Stack
              screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
            >
              <Stack.Protected
                guard={session !== null && (isSignedIn || IS_SIGN_IN_BYPASSED)}
                redirectTo={WREN_ROUTES.signIn}
              >
                <Stack.Screen name={WREN_SCREENS.tabs} />
                <Stack.Screen name={WREN_SCREENS.album} />
                <Stack.Screen name={WREN_SCREENS.artist} />
                <Stack.Screen name={WREN_SCREENS.playlist} />
                <Stack.Screen name={WREN_SCREENS.collection} />
                <Stack.Screen name={WREN_SCREENS.nowPlaying} options={nowPlayingOptions} />
              </Stack.Protected>
              <Stack.Screen name={WREN_SCREENS.signIn} />
            </Stack>
          </WrenShell>
          <ToastHost />
        </GestureHandlerRootView>
      </QueryClientProvider>
    )
  )
}

const HAS_TABLET_CHROME = {
  [FORM_FACTORS.phone]: false,
  [FORM_FACTORS.tablet]: true,
} as const satisfies Record<FormFactor, boolean>

type WrenShellProps = { children: ReactNode }

/*
 * What frames the routes. On a phone, the mini player at the foot of a page the stack pushed
 * (the tabs draw their own above the tab bar). On a tablet, the sidebar beside the routes and
 * the player bar under them, except on sign-in and Now Playing, which are drawn alone.
 */
function WrenShell({ children }: WrenShellProps) {
  const styles = useStyles()
  const chrome = useChrome()
  const hasTabletChrome = HAS_TABLET_CHROME[useFormFactor()] && chrome !== CHROMES.bare
  return (
    <View style={styles.root}>
      <View style={styles.main}>
        {hasTabletChrome && <TabletSidebar />}
        <View style={styles.root}>{children}</View>
      </View>
      {hasTabletChrome && <TabletPlayerBar />}
      <NowPlayingBar place={BAR_PLACES.page} />
    </View>
  )
}

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  main: { flex: 1, flexDirection: 'row' },
}))
