import AsyncStorage from '@react-native-async-storage/async-storage'
import { followAccountServers } from '@raven/native'
import {
  IGNORED,
  IS_SIGN_IN_BYPASSED,
  tokenRenewalFor,
  useStoresLoaded,
} from '@raven/native/headless'
import { COLOR_SCHEMES, type ColorScheme } from '@raven/wren'
import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { hideAsync, preventAutoHideAsync } from 'expo-splash-screen'
import { useEffect } from 'react'
import { StatusBar, View } from 'react-native'

import { VideoAudioHost } from '@/music/VideoAudioHost'
import { forgetWrenAccount, queryClient } from '@/queryClient'
import { useMediaKeys } from '@/remote/useMediaKeys'
import {
  useWrenAccount,
  accountServers,
  useActiveServer,
  configureRecentSearches,
  useWren,
} from '@raven/wren-native'
import { WREN_ROUTES, WREN_SCREENS } from '@raven/wren-native/headless'
import { configureWrenPrefs } from '@/stores/wrenPrefs'
import { themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { ToastHost } from '@/ui/Toast'
import { TopShelfSync } from '@/topShelf/TopShelfSync'

// The splash stays up until the stores are read, so the first screen drawn is the right one.
preventAutoHideAsync().catch(IGNORED)

/** How the system draws its own parts over each scheme's ground. */
const BAR_STYLES = {
  [COLOR_SCHEMES.dark]: 'light-content',
  [COLOR_SCHEMES.light]: 'dark-content',
} as const satisfies Record<ColorScheme, 'light-content' | 'dark-content'>

const useTokenRenewal = tokenRenewalFor({ session: useWrenAccount })

const loadStores = async (): Promise<void> => {
  // A store whose keychain or AsyncStorage cannot be read starts empty rather than holding the splash.
  await Promise.allSettled([
    useActiveServer.persist.rehydrate(),
    useWrenAccount.persist.rehydrate(),
    configureWrenPrefs({ storage: AsyncStorage }),
    configureRecentSearches({ storage: AsyncStorage }),
  ])
}

const useStyles = themedStyles(({ colors }) => ({
  root: { backgroundColor: colors.bg, flex: 1 },
}))

/**
 * Reads what Wren keeps on the TV before any route renders, then the routes. The tabs need a
 * signed-in account on raven, so without one they send the listener to sign in. The account's
 * token is renewed a minute before it ends and the cache emptied when the account changes, as
 * on the phone. Music plays from here, above every route, and the remote's media keys work
 * wherever its focus is.
 */
export function WrenTvRoot() {
  const styles = useStyles()
  const { scheme, colors } = useWrenTheme()
  const isLoaded = useStoresLoaded({ load: loadStores })
  const session = useWren()
  const isSignedIn = useWrenAccount((state) => state.session !== null)
  const isOpen = session !== null && (isSignedIn || IS_SIGN_IN_BYPASSED)

  useTokenRenewal()
  useMediaKeys()
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
        <View style={styles.root}>
          <StatusBar barStyle={BAR_STYLES[scheme]} />
          {session !== null && <VideoAudioHost key={session.server.id} session={session} />}
          {/* The Apple TV's Top Shelf: the latest releases while the tabs are open, else the invitation to sign in. */}
          <TopShelfSync session={isOpen ? session : null} />
          <Stack
            screenOptions={{
              headerShown: false,
              animation: 'fade',
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Protected guard={isOpen} redirectTo={WREN_ROUTES.signIn}>
              <Stack.Screen name={WREN_SCREENS.tabs} />
              <Stack.Screen name={WREN_SCREENS.album} />
              <Stack.Screen name={WREN_SCREENS.artist} />
              <Stack.Screen name={WREN_SCREENS.playlist} />
              <Stack.Screen name={WREN_SCREENS.collection} />
              <Stack.Screen name={WREN_SCREENS.nowPlaying} />
            </Stack.Protected>
            <Stack.Screen name={WREN_SCREENS.signIn} />
          </Stack>
          <ToastHost />
        </View>
      </QueryClientProvider>
    )
  )
}
