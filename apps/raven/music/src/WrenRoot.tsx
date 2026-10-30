import { DEFAULT_THEME, THEME_TONES, themeOf } from '@raven/core'
import { IS_SIGN_IN_BYPASSED, pinRavenServer } from '@raven/native/headless'
import { createQueryClient } from '@raven/ui/headless'
import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { hideAsync, preventAutoHideAsync } from 'expo-splash-screen'
import { useEffect, useState } from 'react'
import { StatusBar } from 'react-native'

import { WREN_ROUTES, WREN_SCREENS } from '@/routes'
import { useWrenAccount } from '@/session'
import { useActiveServer } from '@/stores/activeServer'
import { PALETTE } from '@/theme/wrenTheme'
import { useWren } from '@/useWren'

/** One cache for Wren's life: it talks to one server, so nothing ever empties it. */
const queryClient = createQueryClient()

/** A splash the system cannot hold or hide leaves Wren as it is: the next frame is Wren's. */
const SPLASH_IGNORED = (): void => undefined

// The splash stays up until the stores are read, so the first screen drawn is the right one.
preventAutoHideAsync().catch(SPLASH_IGNORED)

/** How the system draws the clock and battery over Wren's ground, light or dark as it is. */
const BAR_STYLE =
  themeOf(DEFAULT_THEME).tone === THEME_TONES.light ? 'dark-content' : 'light-content'

/** How long before the access token ends Wren asks for a new one. */
const REFRESH_LEAD_MS = 60_000

const loadStores = async (): Promise<void> => {
  // A store whose keychain cannot be read starts empty rather than holding Wren on the splash.
  await Promise.allSettled([
    useActiveServer.persist.rehydrate(),
    useWrenAccount.persist.rehydrate(),
  ])
  pinRavenServer({ servers: useActiveServer })
}

/**
 * Reads what Wren keeps on the device before any route renders, then the routes. The tabs need
 * a signed-in account on raven, so without one they send the listener to sign in. The account's
 * access token is renewed a minute before it ends, so a call never meets an expired one.
 */
export function WrenRoot() {
  const [isLoaded, setLoaded] = useState(false)
  const session = useWren()
  const isSignedIn = useWrenAccount((state) => state.session !== null)
  const expiresAt = useWrenAccount((state) => state.session?.expiresAt ?? null)

  useEffect(() => {
    const show = () => setLoaded(true)
    loadStores().then(show, show)
  }, [])
  useEffect(() => {
    if (expiresAt === null) return undefined
    const timer = setTimeout(
      () => {
        useWrenAccount
          .getState()
          .refresh()
          .catch(() => undefined)
      },
      Math.max(0, expiresAt - Date.now() - REFRESH_LEAD_MS),
    )
    return () => clearTimeout(timer)
  }, [expiresAt])
  useEffect(() => {
    if (isLoaded) hideAsync().catch(SPLASH_IGNORED)
  }, [isLoaded])

  if (!isLoaded) return null
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar barStyle={BAR_STYLE} />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: PALETTE.ground } }}
      >
        <Stack.Protected
          guard={session !== null && (isSignedIn || IS_SIGN_IN_BYPASSED)}
          redirectTo={WREN_ROUTES.signIn}
        >
          <Stack.Screen name={WREN_SCREENS.tabs} />
        </Stack.Protected>
        <Stack.Screen name={WREN_SCREENS.signIn} />
      </Stack>
    </QueryClientProvider>
  )
}
