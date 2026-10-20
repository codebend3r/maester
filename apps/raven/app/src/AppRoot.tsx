import AsyncStorage from '@react-native-async-storage/async-storage'
import { configureStorage, createQueryClient } from '@raven/ui/headless'
import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useEffect, useState } from 'react'
import { View } from 'react-native'

import { clearOnServerSwitch } from '@/queries/serverCache'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { useUnlockRoute } from '@/queries/useUnlockRoute'
import { APP_ROUTES, APP_SCREENS } from '@/routes'
import { useActiveServer } from '@/stores/activeServer'
import { configureLibraryViews } from '@/stores/libraryViews'
import { followReduceMotion } from '@/stores/reduceMotion'
import { COLOURS } from '@/theme/appTheme'

/** One cache for the app's life, emptied whenever the active server changes. */
const queryClient = createQueryClient()

const loadStores = async (): Promise<void> => {
  // A store whose storage cannot be read starts from its defaults rather than holding
  // the app on a blank screen; the next write puts the file right.
  await Promise.allSettled([
    configureStorage({ storage: AsyncStorage }),
    configureLibraryViews({ storage: AsyncStorage }),
    useActiveServer.persist.rehydrate(),
  ])
}

/** Keeps the cache in step with the active server's event stream, while it is the active one. */
const ServerEvents = ({ session }: { session: AppQueries }) => {
  session.useServerEvents()
  return null
}

const UnlockRoute = () => {
  useUnlockRoute()
  return null
}

/**
 * Loads what the app keeps on the device before any route renders, then the routes. Every
 * route but sign-in needs a server, so without one they send the viewer to sign in.
 */
export const AppRoot = () => {
  const [isLoaded, setLoaded] = useState(false)
  const session = useAppQueries()

  useEffect(() => {
    void loadStores().then(() => setLoaded(true))
  }, [])
  useEffect(() => clearOnServerSwitch({ client: queryClient, store: useActiveServer }), [])
  useEffect(() => followReduceMotion(), [])

  if (!isLoaded) return <View style={{ flex: 1, backgroundColor: COLOURS.ground }} />
  return (
    <QueryClientProvider client={queryClient}>
      {session !== null && <ServerEvents key={session.server.id} session={session} />}
      <UnlockRoute />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLOURS.ground } }}
      >
        <Stack.Protected guard={session !== null} redirectTo={APP_ROUTES.signIn}>
          <Stack.Screen name={APP_SCREENS.home} />
          <Stack.Screen name={APP_SCREENS.item} />
          <Stack.Screen name={APP_SCREENS.library} />
          <Stack.Screen name={APP_SCREENS.unlock} />
        </Stack.Protected>
      </Stack>
    </QueryClientProvider>
  )
}
