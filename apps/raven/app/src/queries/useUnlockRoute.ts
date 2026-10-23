import { useUnlockPrompt } from '@raven/ui/headless'
import { usePathname, useRouter } from 'expo-router'
import { useEffect } from 'react'

import { APP_ROUTES } from '@/routes'

/**
 * Opens the PIN screen when the query client hears a 423, a page refused for sitting in a
 * locked library, as the web opens its PIN dialog. The prompt is closed as the screen opens,
 * so the next refusal asks again; one that comes while the screen is open asks nothing more.
 */
export const useUnlockRoute = (): void => {
  const isAsked = useUnlockPrompt((state) => state.open)
  const close = useUnlockPrompt((state) => state.close)
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => {
    if (!isAsked) return
    close()
    if (pathname !== APP_ROUTES.unlock) router.push(APP_ROUTES.unlock)
  }, [isAsked, close, router, pathname])
}
