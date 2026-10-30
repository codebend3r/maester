import AsyncStorage from '@react-native-async-storage/async-storage'
import { THEME_TONES } from '@raven/core'
import { configureStorage, createQueryClient } from '@raven/ui/headless'
import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { hideAsync, preventAutoHideAsync } from 'expo-splash-screen'
import { useEffect, useState } from 'react'
import { Appearance, StatusBar, StyleSheet, View } from 'react-native'
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAccountSession } from '@/account/accountSession'
import { clearOnServerSwitch } from '@/queries/serverCache'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { MusicHost } from '@/music/MusicHost'
import { NowPlayingBar, useIsBarShown } from '@/music/NowPlayingBar'
import { useUnlockRoute } from '@/queries/useUnlockRoute'
import { APP_ROUTES, APP_SCREENS } from '@/routes'
import { IS_SIGN_IN_BYPASSED, RAVEN_SERVER } from '@/servers/ravenServer'
import { useActiveServer } from '@/stores/activeServer'
import { configureAppPrefs } from '@/stores/appPrefs'
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

/**
 * The installed app talks to one server, raven on Vhagar, and never asks for another. An end
 * to end build leaves its fixture absent until the PIN and admin password have been accepted.
 */
const pinRavenServer = (): void => {
  if (IS_SIGN_IN_BYPASSED) return
  const { servers, add, remove, activate } = useActiveServer.getState()
  servers
    .filter(({ id }) => id !== RAVEN_SERVER.id)
    .forEach(({ id }) => {
      remove(id).catch(() => undefined)
    })
  if (!servers.some(({ id }) => id === RAVEN_SERVER.id)) add(RAVEN_SERVER)
  activate(RAVEN_SERVER.id)
}

/** How long before the access token ends the app asks for a new one. */
const REFRESH_LEAD_MS = 60_000

const loadStores = async (): Promise<void> => {
  // A store whose storage cannot be read starts from its defaults rather than holding
  // the app on a blank screen; the next write puts the file right.
  await Promise.allSettled([
    configureStorage({ storage: AsyncStorage }),
    configureLibraryViews({ storage: AsyncStorage }),
    configureAppPrefs({ storage: AsyncStorage }),
    configureSideMenu({ storage: AsyncStorage }),
    useActiveServer.persist.rehydrate(),
    useAccountSession.persist.rehydrate(),
  ])
  pinRavenServer()
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

const UnlockRoute = () => {
  useUnlockRoute()
  return null
}

/**
 * Loads what the app keeps on the device before any route renders, then the routes. Every
 * route but sign-in needs a server, so without one they send the viewer to sign in. Until the
 * prefs are read the splash stays up and the app paints nothing, so the first frame of a theme
 * is the one picked, never the default's on its way to it; the splash goes once that frame is
 * drawn, and after that a theme picked in Settings repaints everything at once.
 */
export const AppRoot = () => {
  const [isLoaded, setLoaded] = useState(false)
  const session = useAppQueries()
  const isSignedIn = useAccountSession((state) => state.session !== null)
  const expiresAt = useAccountSession((state) => state.session?.expiresAt ?? null)
  const ground = useTheme((theme) => theme.palette.ground)
  const tone = useTheme((theme) => theme.tone)
  const insets = useSafeAreaInsets()
  const isBarShown = useIsBarShown()

  useEffect(() => {
    const show = () => setLoaded(true)
    loadStores().then(show, show)
  }, [])
  useEffect(() => clearOnServerSwitch({ client: queryClient, store: useActiveServer }), [])
  useEffect(() => followReduceMotion(), [])
  useEffect(() => {
    if (expiresAt === null) return undefined
    const timer = setTimeout(
      () => {
        useAccountSession
          .getState()
          .refresh()
          .catch(() => undefined)
      },
      Math.max(0, expiresAt - Date.now() - REFRESH_LEAD_MS),
    )
    return () => clearTimeout(timer)
  }, [expiresAt])
  useEffect(() => (isLoaded ? followTheme({ apply: wearSystemLook }) : undefined), [isLoaded])
  useEffect(() => {
    if (isLoaded) hideAsync().catch(SPLASH_IGNORED)
  }, [isLoaded])

  if (!isLoaded) return null
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar barStyle={tone === THEME_TONES.light ? 'dark-content' : 'light-content'} />
      {session !== null && <ServerEvents key={session.server.id} session={session} />}
      <UnlockRoute />
      {/* Music plays above the routes, so leaving a screen stops nothing. */}
      {session !== null && <MusicHost key={session.server.id} session={session} />}
      {/* A screen's opening focus comes back once the transition that reveals it has ended:
          on Android TV the transition takes the focus from anything asked for before then. */}
      <View style={styles.frame}>
        {/* The bar keeps the bottom inset for itself, so the screens above it pad none. */}
        <SafeAreaInsetsContext.Provider value={isBarShown ? { ...insets, bottom: 0 } : insets}>
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
              <Stack.Screen name={APP_SCREENS.nowPlaying} />
              <Stack.Screen name={APP_SCREENS.search} />
              <Stack.Screen name={APP_SCREENS.settings} />
              <Stack.Screen name={APP_SCREENS.unlock} />
            </Stack.Protected>
          </Stack>
        </SafeAreaInsetsContext.Provider>
        {/* The bar under the screens while a track plays; Now Playing is a screen of its own. */}
        {session !== null && <NowPlayingBar session={session} />}
      </View>
    </QueryClientProvider>
  )
}

const styles = StyleSheet.create({ frame: { flex: 1 } })
