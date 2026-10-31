import AsyncStorage from '@react-native-async-storage/async-storage'
import { DEFAULT_THEME, THEME_TONES, themeOf } from '@raven/core'
import { IS_SIGN_IN_BYPASSED, pinRavenServer, tokenRenewalFor } from '@raven/native/headless'
import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { hideAsync, preventAutoHideAsync } from 'expo-splash-screen'
import { useEffect, useState } from 'react'
import { StatusBar, StyleSheet, View } from 'react-native'

import { BAR_PLACES, NowPlayingBar } from '@/components/NowPlayingBar'
import { downloadSources } from '@/downloads/downloadDevice'
import { configureDownloads } from '@/downloads/downloadStore'
import { deviceDisk } from '@/downloads/downloader'
import { WrenAudioHost } from '@/music/WrenAudioHost'
import { forgetOnAccountChange, queryClient } from '@/queryClient'
import { WREN_ROUTES, WREN_SCREENS } from '@/routes'
import { useWrenAccount } from '@/session'
import { useActiveServer } from '@/stores/activeServer'
import { configureWrenPrefs } from '@/stores/wrenPrefs'
import { PALETTE } from '@/theme/wrenTheme'
import { useWren } from '@/useWren'

/** A splash the system cannot hold or hide leaves Wren as it is: the next frame is Wren's. */
const SPLASH_IGNORED = (): void => undefined

// The splash stays up until the stores are read, so the first screen drawn is the right one.
preventAutoHideAsync().catch(SPLASH_IGNORED)

/** How the system draws the clock and battery over Wren's ground, light or dark as it is. */
const BAR_STYLE =
  themeOf(DEFAULT_THEME).tone === THEME_TONES.light ? 'dark-content' : 'light-content'

const useTokenRenewal = tokenRenewalFor({ session: useWrenAccount })

const loadStores = async (): Promise<void> => {
  // A store whose keychain or AsyncStorage cannot be read starts empty rather than holding
  // Wren on the splash.
  await Promise.allSettled([
    useActiveServer.persist.rehydrate(),
    useWrenAccount.persist.rehydrate(),
    configureWrenPrefs({ storage: AsyncStorage }),
    configureDownloads({ storage: AsyncStorage, disk: deviceDisk, ...downloadSources }),
  ])
  pinRavenServer({ servers: useActiveServer })
}

/**
 * Reads what Wren keeps on the device before any route renders, then the routes. The tabs need
 * a signed-in account on raven, so without one they send the listener to sign in. The account's
 * access token is renewed a minute before it ends, so a call never meets an expired one, and
 * the cache is emptied when the account changes. Music plays from here, above every route, and
 * the now-playing bar sits at the foot of the pages the stack opens.
 */
export function WrenRoot() {
  const [isLoaded, setLoaded] = useState(false)
  const session = useWren()
  const isSignedIn = useWrenAccount((state) => state.session !== null)

  useTokenRenewal()
  useEffect(forgetOnAccountChange, [])
  useEffect(() => {
    const show = () => setLoaded(true)
    loadStores().then(show, show)
  }, [])
  useEffect(() => {
    if (isLoaded) hideAsync().catch(SPLASH_IGNORED)
  }, [isLoaded])

  return (
    isLoaded && (
      <QueryClientProvider client={queryClient}>
        <StatusBar barStyle={BAR_STYLE} />
        {session !== null && <WrenAudioHost key={session.server.id} session={session} />}
        <View style={styles.screen}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: PALETTE.ground },
            }}
          >
            <Stack.Protected
              guard={session !== null && (isSignedIn || IS_SIGN_IN_BYPASSED)}
              redirectTo={WREN_ROUTES.signIn}
            >
              <Stack.Screen name={WREN_SCREENS.tabs} />
              <Stack.Screen name={WREN_SCREENS.album} />
              <Stack.Screen name={WREN_SCREENS.artist} />
              <Stack.Screen name={WREN_SCREENS.playlist} />
              <Stack.Screen name={WREN_SCREENS.nowPlaying} options={{ presentation: 'modal' }} />
            </Stack.Protected>
            <Stack.Screen name={WREN_SCREENS.signIn} />
          </Stack>
          <NowPlayingBar place={BAR_PLACES.page} />
        </View>
      </QueryClientProvider>
    )
  )
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: PALETTE.ground } })
